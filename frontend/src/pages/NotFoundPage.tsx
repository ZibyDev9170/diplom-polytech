import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="page">
      <p className="eyebrow">404</p>
      <h1>Раздел не найден</h1>
      <Link className="button-link" to="/">
        Вернуться в обзор
      </Link>
    </section>
  );
}
