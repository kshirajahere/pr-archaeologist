'use client';

import { WidgetLayout, useTheme, useWidgetSDK } from '@nitrostack/widgets';
import { ReviewCard, type ReviewData } from '../../components/review-card';

export default function ReviewWidget() {
  return <WidgetLayout><ReviewContent /></WidgetLayout>;
}

function ReviewContent() {
  const theme = useTheme();
  const { getToolOutput } = useWidgetSDK();
  const data = getToolOutput<ReviewData>();
  if (!data || !Array.isArray(data.findings)) return <main className="review-card empty" role="status"><p className="product">PR Archaeologist</p><h1>Your review evidence appears here.</h1><p>Run <code>check_pr_against_rules</code> in NitroStudio or your MCP client to see the changed lines and their sources.</p></main>;
  return <ReviewCard data={data} dark={theme === 'dark'} />;
}
