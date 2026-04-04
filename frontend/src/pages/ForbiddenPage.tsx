import { Link } from "react-router-dom";

export function ForbiddenPage() {
  return (
    <section className="page">
      <p className="eyebrow">403</p>
      <h1>Нет доступа</h1>
      <p className="lead">Для этого раздела нужна другая роль.</p>
      <Link className="button-link" to="/">
        Вернуться в обзор
      </Link>
    </section>
  );
}
