'use client';

export interface Finding {
  path: string; line: number; code: string; rule_id: string; rule: string; confidence: number;
  source: { pr: number; quote: string; url: string; author: string; date: string };
}
export interface ReviewData { repo: string; pr: number; findings: Finding[]; unchecked_paths?: string[]; coverage?: string }

function sourceLink(url: string) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+#discussion_r\d+$/.test(url) ? url : undefined;
}

export function ReviewCard({ data, dark = false }: { data: ReviewData; dark?: boolean }) {
  return <main className={`review-card${dark ? ' dark' : ''}`}>
    <header className="review-header">
      <div><p className="product">PR Archaeologist</p><h1>Review with memory.</h1><p className="repository">{data.repo} <span aria-hidden="true">/</span> #{data.pr}</p></div>
      <div className="finding-count"><strong>{data.findings.length}</strong><span>{data.findings.length === 1 ? 'finding' : 'findings'}</span></div>
    </header>
    <p className="review-intro">Every flag leads back to a team decision.</p>
    {data.findings.length === 0 && <section className="empty"><h2>No supported rule violations found</h2><p>Continue the review for behavior, design and patterns outside the learned rulebook.</p></section>}
    <ol className="findings">
      {data.findings.map(f => <li className="finding" key={`${f.path}:${f.line}:${f.rule_id}`}>
        <div className="finding-location"><span><strong>{f.path}</strong> :{f.line}</span><span className="support">{Math.round(f.confidence * 100)}% support confidence</span></div>
        <div className="code-line"><span className="line-number" aria-label={`Line ${f.line}`}>{f.line}</span><code><span aria-hidden="true">+ </span>{f.code.trim()}</code></div>
        <div className="finding-evidence"><h2>{f.rule}</h2><blockquote>{f.source.quote}</blockquote><div className="source-meta"><span>@{f.source.author} · {f.source.date.slice(0, 10)}</span><a href={sourceLink(f.source.url)} target="_blank" rel="noopener noreferrer">Original comment in #{f.source.pr} <span aria-hidden="true">↗</span></a></div></div>
      </li>)}
    </ol>
    {!!data.unchecked_paths?.length && <p className="coverage">Patches unavailable: {data.unchecked_paths.join(', ')}</p>}
    <footer className="coverage">{data.coverage ?? 'Findings are suggestions backed by recurring review comments. Confidence reflects support, not certainty.'}</footer>
  </main>;
}
