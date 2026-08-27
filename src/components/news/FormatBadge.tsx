import type { ArticleFormat } from '../../news-types';

const FORMAT_STYLES: Record<ArticleFormat, { label: string; title: string }> = {
  weekly_wrap: {
    label: 'The week',
    title:
      'A digest of what we reported over the past week. The figures in it were measured in their own periods, which are named beside each one: the week is when we published, not when they were recorded.',
  },
};

/**
 * Says what KIND of piece this is, beside the tier badge that says where it
 * came from.
 *
 * A weekly wrap is not a maritime report even when the week was mostly
 * maritime, and the first one published was indistinguishable from the two
 * genuine maritime stories beside it — same section, same beat correspondent,
 * same shape. It was retracted for a different fault, but a reader could not
 * have told it apart from ordinary reporting, and that is its own problem.
 *
 * Deliberately says nothing when `format` is absent. Almost every article is
 * an ordinary report, and labelling the normal case teaches a reader to stop
 * reading the label.
 */
export function FormatBadge({ format }: { format?: ArticleFormat }) {
  if (!format) return null;
  const style = FORMAT_STYLES[format];
  if (!style) return null;
  return (
    <span
      title={style.title}
      className="news-tier-accent inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-caption font-semibold uppercase tracking-widest"
    >
      {style.label}
    </span>
  );
}
