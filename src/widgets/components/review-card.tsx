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
  const findings = Array.isArray(data?.findings) ? data.findings : [];
  return <main className={`review-card${dark ? ' dark' : ''}`}>
    <header className="review-header">
      <div><p className="product">PR Archaeologist</p><h1>Review with memory.</h1><p className="repository">{data.repo} <span aria-hidden="true">/</span> #{data.pr}</p></div>
      <div className="finding-count"><strong>{findings.length}</strong><span>{findings.length === 1 ? 'finding' : 'findings'}</span></div>
    </header>
    <p className="review-intro">Every flag leads back to a team decision.</p>
    {findings.length === 0 && <section className="empty"><h2>No supported rule violations found</h2><p>Continue the review for behavior, design and patterns outside the learned rulebook.</p></section>}
    <ol className="findings">
      {findings.map(f => {
        const code = typeof f?.code === 'string' ? f.code.trim() : '';
        const confidence = Number.isFinite(f?.confidence) ? `${Math.round(f.confidence * 100)}% support confidence` : 'unscored';
        const date = typeof f?.source?.date === 'string' ? f.source.date.slice(0, 10) : '';
        const href = sourceLink(typeof f?.source?.url === 'string' ? f.source.url : '');
        const label = <>Original comment in #{f?.source?.pr} <span aria-hidden="true">↗</span></>;
        return <li className="finding" key={`${f?.path}:${f?.line}:${f?.rule_id}`}>
          <div className="finding-location"><span><strong>{f?.path}</strong> :{f?.line}</span><span className="support">{confidence}</span></div>
          <div className="code-line"><span className="line-number" aria-label={`Line ${f?.line}`}>{f?.line}</span><code><span aria-hidden="true">+ </span>{code}</code></div>
          <div className="finding-evidence"><h2>{f?.rule}</h2><blockquote>{f?.source?.quote}</blockquote><div className="source-meta"><span>@{f?.source?.author} · {date}</span>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <a rel="noopener noreferrer">{label}</a>}</div></div>
        </li>;
      })}
    </ol>
    {!!data.unchecked_paths?.length && <p className="coverage">Patches unavailable: {data.unchecked_paths.join(', ')}</p>}
    <footer className="coverage">{data.coverage ?? 'Findings are suggestions backed by recurring review comments. Confidence reflects support, not certainty.'}</footer>
  </main>;
}
