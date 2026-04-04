type PlaceholderPageProps = {
  eyebrow: string;
  text: string;
};

export function PlaceholderPage({ eyebrow, text }: PlaceholderPageProps) {
  return (
    <section className="page">
      <p className="lead">{text}</p>
    </section>
  );
}
