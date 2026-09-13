import type { ComponentProps, ReactNode } from 'react';

export function PageTitle({ className = '', ...props }: ComponentProps<'h1'>) {
  return <h1 {...props} className={`site-page-title balance-text text-display md:text-masthead font-semibold ${className}`} />;
}

interface PageIntroProps {
  title: ReactNode;
  lead: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  backLink?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageIntro({ title, lead, description, actions, aside, backLink, children, className = '' }: PageIntroProps) {
  return (
    <header className={`site-page-intro${aside ? ' site-page-intro-with-aside' : ''} ${className}`}>
      <div className="site-page-copy">
        {backLink}
        <PageTitle className="news-fg">{title}</PageTitle>
        <p className="site-page-lead text-prose news-muted">{lead}</p>
        {description && <p className="site-page-description text-ui news-subtle">{description}</p>}
        {children}
        {actions && <div className="site-page-actions">{actions}</div>}
      </div>
      {aside && <div className="site-page-aside">{aside}</div>}
    </header>
  );
}
