import policySource from '../../../newsroom/policy/ai-use.md?raw';
import { Markdown } from '../../newsroom/markdown';
import { usePageMeta } from '../../newsroom/usePageMeta';
import { PolicyFooter } from './PolicyFooter';

/**
 * The AI-use policy.
 *
 * The text is rendered from newsroom/policy/ai-use.md, which is the
 * authoritative copy. Do not restate any of it in JSX here: the point of
 * rendering from source is that the published commitments have exactly one
 * place to be edited, and cannot drift away from what this page shows.
 */
export default function AiPolicyPage() {
  usePageMeta({
    title: 'How portaBaltica uses AI',
    description:
      'What the AI does here, what it is not permitted to do, and who answers for it when something is wrong.',
    canonicalPath: '/about/ai',
  });

  return (
    <div className="mx-auto max-w-measure">
      <Markdown source={policySource} />
      <PolicyFooter sourcePath="newsroom/policy/ai-use.md" />
    </div>
  );
}
