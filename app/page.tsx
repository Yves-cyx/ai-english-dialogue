import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <section className="card landing-card">
        <h1 className="title">AI English Dialogue Practice</h1>
        <p className="landing-intro">
          I’m Chen Yixuan. This is a platform I built to practice English
          speaking. I hope you enjoy using it.
        </p>
        <ul className="feature-list">
          <li className="feature-item">🎙️ Voice-first practice (optional)</li>
          <li className="feature-item">✅ Guided next-step suggestions</li>
          <li className="feature-item">💾 Your progress saved locally</li>
        </ul>
        <Link className="primary-button btnPrimary" href="/practice">
          Go to Practice
        </Link>
      </section>
    </main>
  );
}
