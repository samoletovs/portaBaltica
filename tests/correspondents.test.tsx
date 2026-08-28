import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  BYLINE_SUFFIX,
  CORRESPONDENTS,
  SECTION_ROUTING,
  getCorrespondent,
  renderByline,
} from '../src/newsroom/correspondents';
import { CorrespondentAvatar } from '../src/components/news/CorrespondentAvatar';
import CorrespondentPage from '../src/components/news/CorrespondentPage';

describe('renderByline', () => {
  it.each(CORRESPONDENTS)('discloses for $name', (correspondent) => {
    expect(renderByline(correspondent)).toContain(BYLINE_SUFFIX);
  });

  it('produces the exact contracted form', () => {
    expect(renderByline({ name: 'Nida', beat: 'Economy & Labour' })).toBe(
      'Nida · AI correspondent, Economy & Labour',
    );
  });

  it('replaces a stored byline that does not disclose', () => {
    // The Sports Illustrated failure mode in one line: a byline that reads as
    // a staff journalist's. It must never survive to the page.
    expect(renderByline({ name: 'Marta Ozola', beat: 'Economy & Labour', byline: 'Marta Ozola' })).toContain(
      BYLINE_SUFFIX,
    );
  });

  it('still discloses when the beat is unknown', () => {
    expect(renderByline({ name: 'Nida' })).toBe('Nida · AI correspondent');
  });

  it('preserves a stored byline that already discloses', () => {
    expect(
      renderByline({ name: 'Kolka', beat: 'Maritime & Trade', byline: 'Kolka · AI correspondent, Maritime & Trade' }),
    ).toBe('Kolka · AI correspondent, Maritime & Trade');
  });
});

describe('correspondent registry', () => {
  it('has five correspondents, each with a declared expertise', () => {
    expect(CORRESPONDENTS).toHaveLength(5);
    expect(CORRESPONDENTS.map((c) => c.id).sort()).toEqual([
      'akmensrags',
      'irbene',
      'kolka',
      'nida',
      'ristna',
    ]);
    CORRESPONDENTS.forEach((correspondent) => {
      // Expertise is what a reader is asked to trust the byline for, so an
      // empty one is a correspondent with nothing to be held to.
      expect(correspondent.expertise.length).toBeGreaterThan(0);
      expect(correspondent.trainedOn.length).toBeGreaterThan(0);
      // The names are invented people now, not places. What must never
      // change is that the byline still says so.
      expect(renderByline(correspondent)).toContain('AI correspondent');
    });
  });

  it('routes every dashboard section to a real correspondent', () => {
    Object.values(SECTION_ROUTING).forEach((personaId) => {
      expect(getCorrespondent(personaId)).toBeDefined();
    });
  });
});

describe('CorrespondentAvatar', () => {
  it('is an abstract generated mark, explicitly not a photograph', () => {
    const { container } = render(<CorrespondentAvatar id="nida" />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Generated vector only — never an <image>, never a raster portrait.
    expect(svg!.querySelector('image')).toBeNull();
    expect(svg!.getAttribute('aria-label')).toContain('Not a photograph of a person');
  });
});

describe('Correspondent bio page', () => {
  // The page lists the correspondent's recent articles; the index fetch is
  // stubbed out so these tests never touch the network.
  afterEach(() => vi.unstubAllGlobals());

  function renderBio(id: string) {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in tests')));
    return render(
      <MemoryRouter initialEntries={[`/newsroom/${id}`]}>
        <Routes>
          <Route path="/newsroom/:id" element={<CorrespondentPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('states plainly that the correspondent is an AI system, not a person', () => {
    renderBio('nida');

    expect(screen.getByRole('heading', { name: 'Ilze Nida is not a person' })).toBeTruthy();
    expect(screen.getByText(/is an AI system/)).toBeTruthy();
    // The names read as people now, so the denial has to be explicit rather
    // than implied by an obviously non-human name.
    expect(screen.getByText(/There is nobody of this name/)).toBeTruthy();
  });

  it('names the datasets it works from', () => {
    renderBio('akmensrags');

    expect(screen.getByRole('heading', { name: /Works only from these datasets/i })).toBeTruthy();
    expect(screen.getByText(/Elering \/ Nord Pool/)).toBeTruthy();
  });

  it('renders a dataset list for every correspondent, so the promise is never empty', () => {
    // The heading is "Works only from these datasets". Rendered above nothing at
    // all it reads as "no sources", which is a different false impression from
    // the one being fixed rather than an honest shorter list -- so removing an
    // untrue entry must never empty a list.
    //
    // This is the reader-facing half. Whether each id is a source the pipeline
    // actually fetches is decided in
    // `newsroom/tests/pipeline/test_correspondent_datasets.py`, which derives
    // the permitted set by *running* both collectors. It lives on the Python
    // side because that is where the collectors are: asserting it here would
    // mean restating their behaviour in a second language, which is the
    // drift this repository keeps writing post-mortems about.
    for (const correspondent of CORRESPONDENTS) {
      expect(
        correspondent.datasets.length,
        `${correspondent.id} would render the heading above an empty list`,
      ).toBeGreaterThan(0);

      for (const dataset of correspondent.datasets) {
        expect(dataset.sourceId, `${correspondent.id} has a dataset with no source id`).toBeTruthy();
        expect(dataset.label, `${correspondent.id}/${dataset.sourceId} has no label`).toBeTruthy();
      }
    }
  });

  it('no longer claims sources the newsroom never fetches', () => {
    // These five were listed while no collector requested them. `statee` and
    // `datagovlt` were found by a repository-wide grep; `datagovlv`, `ecb` and
    // `openmeteo` by then asking what the collectors actually fetch, which is a
    // different and better question.
    //
    // Asserted as an explicit set rather than as a filter: if one of them is
    // wired into a collector and legitimately returns, this fails and has to be
    // updated deliberately, instead of silently matching nothing for ever.
    const NEVER_FETCHED = ['datagovlv', 'statee', 'datagovlt', 'ecb', 'openmeteo'];
    const declared = new Set(
      CORRESPONDENTS.flatMap((c) => c.datasets.map((d) => d.sourceId)),
    );

    expect([...declared].filter((id) => NEVER_FETCHED.includes(id))).toEqual([]);
    // The companion: prove the set being searched is populated, so this cannot
    // pass because `declared` is empty.
    expect(declared.size).toBeGreaterThan(0);
    expect(declared.has('eurostat')).toBe(true);
  });

  it('names the accountable publisher', () => {
    renderBio('kolka');

    expect(screen.getByText('Andre Kõpu')).toBeTruthy();
  });

  it('says the correspondent never interviews, visits or witnesses anything', () => {
    renderBio('ristna');

    expect(
      screen.getByText(/never conducts interviews, attends events, visits anywhere or speaks to sources/i),
    ).toBeTruthy();
  });
});
