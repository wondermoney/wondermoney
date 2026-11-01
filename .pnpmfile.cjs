// Drops optional peer dependencies that only the web and mobile apps provide, so pnpm stops
// resolving them into the API's dependency closure (#100).
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
  '@better-auth/expo': [
    'expo-constants',
    'expo-linking',
    'expo-network',
    'expo-secure-store',
    'expo-web-browser',
  ],
};

function readPackage(pkg) {
  for (const name of DROP_OPTIONAL_PEERS[pkg.name] ?? []) {
    if (pkg.peerDependenciesMeta?.[name]?.optional) {
      delete pkg.peerDependencies[name];
      delete pkg.peerDependenciesMeta[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
