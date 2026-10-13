import Image from 'next/image';

export interface DocsImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  priority?: boolean;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 500;

/**
 * Renders a documentation screenshot with `next/image`.
 *
 * `alt` is required at the type level and guarded at runtime: MDX can pass an
 * empty string through the JSX type checker, so a render-time throw is the
 * final backstop.
 *
 * Width defaults to 800 px and the wrapper caps its rendered width, so the
 * image never exceeds the intended size unless an explicit `width` is set.
 */
export function DocsImage({
  src,
  alt,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  caption,
  priority = false,
}: DocsImageProps) {
  if (alt.trim() === '') {
    throw new Error('DocsImage: "alt" is required and cannot be empty.');
  }

  const image = (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className="h-auto w-full rounded-md border border-fd-border"
    />
  );

  if (caption) {
    return (
      <figure className="my-6 not-prose" style={{ maxWidth: width }}>
        {image}
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="my-6 not-prose" style={{ maxWidth: width }}>
      {image}
    </div>
  );
}
