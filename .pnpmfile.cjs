// Drops peer dependencies that pnpm would otherwise resolve into a package's closure although
// the package never loads them.
//
// pnpm links an optional peer whenever a matching version exists anywhere in the workspace.
// Because web depends on next and mobile on expo, the API's better-auth and @better-auth/expo
// were locked as better-auth(next@...)(vitest@...) and @better-auth/expo(expo-constants@...),
// which put next, sharp, expo, react-native and their trees into the API image and into
// `pnpm audit --prod` for the API. The API never loads them: better-auth only imports next from
// better-auth/next-js, and @better-auth/expo's server entry imports no expo module.
//
// Web and mobile are unaffected: they list next and the expo-* modules as their own
// dependencies, and the hoisted install (nodeLinker: hoisted) places them at the root, where
// better-auth/next-js and @better-auth/expo/client resolve them.
const DROP_OPTIONAL_PEERS = {
  'better-auth': ['next', 'solid-js', 'vitest'],
  // The marketing site does not use Sanity's visual editing; next would link web's Next.js.
  '@sanity/visual-editing': ['@sveltejs/kit', 'next', 'react-router', 'svelte'],
  // Linked per importer, the peer split vitest into variants pinned to different jsdoms, and
  // the hoisted install nested one under the root vitest. Its jsdom environment then loaded
  // that copy while its Blob helper resolved jsdom's internals from the root copy, so web's
  // file-upload tests failed whenever the root copy changed version. Unlinked, vitest loads
  // the hoisted jsdom for both.
  vitest: ['jsdom'],
  '@better-auth/expo': [
    'expo-constants',
    'expo-linking',
    'expo-network',
    'expo-secure-store',
    'expo-web-browser',
  ],
};

// Required peers pnpm would install although nothing loads them. @sanity/astro asks for the
// `sanity` Studio (thousands of packages, among them a second jsdom that changed the hoisted
// layout under web's tests) only for its embedded Studio route, which the marketing site does
// not mount: its integration is configured without `studioBasePath`.
const DROP_PEERS = {
  '@sanity/astro': ['sanity'],
};

function readPackage(pkg) {
  for (const name of DROP_PEERS[pkg.name] ?? []) {
    delete pkg.peerDependencies?.[name];
    delete pkg.peerDependenciesMeta?.[name];
  }
  for (const name of DROP_OPTIONAL_PEERS[pkg.name] ?? []) {
    if (pkg.peerDependenciesMeta?.[name]?.optional) {
      delete pkg.peerDependencies[name];
      delete pkg.peerDependenciesMeta[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
