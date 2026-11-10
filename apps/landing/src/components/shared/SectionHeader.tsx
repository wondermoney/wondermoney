interface Props extends React.HTMLProps<HTMLDivElement> {
  preTitle?: string;
  title: string;
  subTitle?: string;
}

export default function SectionHeader({
  preTitle,
  title,
  subTitle,
  ...rest
}: Props) {
  return (
    <div className="bg-transparent px-6 py-24 lg:px-8" {...rest}>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
          {preTitle && (
            <span className="mb-4 block text-base tracking-normal text-foreground">{preTitle}</span>
          )}{" "}
          {title}
        </h2>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          {subTitle}
        </p>
      </div>
    </div>
  );
}
