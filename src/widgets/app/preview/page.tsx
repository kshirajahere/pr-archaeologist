import { ReviewCard, type ReviewData } from '../../components/review-card';
import manifest from '../../widget-manifest.json';

export default function Preview() {
  return <><p className="preview-label">Fixture preview · fictional repository · no live data</p><ReviewCard data={manifest.widgets[0].examples[0].data as ReviewData} /></>;
}
