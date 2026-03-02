import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <section className="card">
        <h1 className="title">AI English Dialogue Practice</h1>
        <p className="muted">
          Practice real-world conversations with quick, guided prompts.
        </p>
        <Link className="primary-button" href="/practice">
          Go to Practice
        </Link>
      </section>
    </main>
  );
}
