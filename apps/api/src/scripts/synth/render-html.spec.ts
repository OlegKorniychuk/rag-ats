import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CvContent } from './cv-content.js';
import { requiredSnippets } from './cv-check.js';
import { SYNTH_DIR } from './io.js';
import {
  escapeHtml,
  formatMonth,
  formatPeriod,
  HEADINGS,
  LAYOUTS,
  renderCvHtml,
  rolesNewestFirst,
} from './render-html.js';
import {
  BACKEND_EN,
  BACKEND_UK,
  FIXTURE_CVS,
  INJECTION_EN,
  ML_EN,
} from './test-cvs.js';
import type { Layout } from './types.js';

const templates = {} as Record<Layout, string>;
beforeAll(async () => {
  for (const layout of LAYOUTS) {
    templates[layout] = await readFile(
      join(SYNTH_DIR, 'templates', `${layout}.html`),
      'utf8',
    );
  }
});

describe('formatting', () => {
  it('formats months and periods per language', () => {
    expect(formatMonth('2021-03', 'en')).toBe('Mar 2021');
    expect(formatPeriod('2021-03', null, 'en')).toBe('Mar 2021 – Present');
    expect(formatPeriod('2018-02', '2020-06', 'en')).toBe(
      'Feb 2018 – Jun 2020',
    );
    expect(formatPeriod('2021-03', null, 'uk')).toBe('бер. 2021 – дотепер');
    expect(formatMonth('2020-12', 'uk')).toBe('груд. 2020');
  });

  it('rejects a malformed month', () => {
    expect(() => formatMonth('2021-13', 'en')).toThrow(/YYYY-MM/);
    expect(() => formatMonth('March 2021', 'en')).toThrow(/YYYY-MM/);
  });

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });

  it('orders roles newest first, the current role on top', () => {
    const sorted = rolesNewestFirst(BACKEND_EN.roles).map((r) => r.employer);
    expect(sorted).toEqual([
      'Driftwood Apps',
      'Vantage Reed',
      'Marlowe & Finch Tech',
    ]);
    // Input order does not matter.
    const shuffled = [...BACKEND_EN.roles].reverse();
    expect(rolesNewestFirst(shuffled).map((r) => r.employer)).toEqual(sorted);
  });
});

describe.each(LAYOUTS)('renderCvHtml (%s)', (layout) => {
  it.each(FIXTURE_CVS.map((cv) => [cv.personaId, cv] as const))(
    'contains all text of %s, escaped',
    (_id, cv) => {
      const html = renderCvHtml(cv, layout, templates[layout]);
      for (const snippet of requiredSnippets(cv)) {
        expect(html).toContain(escapeHtml(snippet));
      }
      expect(html).not.toMatch(/\{\{/);
      expect(html).toContain(`<html lang="${cv.language}">`);
    },
  );

  it('never lets markup from the content through', () => {
    const evil: CvContent = {
      ...BACKEND_EN,
      name: 'Eve <img src=x onerror=alert(1)>',
      summary: 'Fine </p><script>alert("s")</script>',
      roles: [
        {
          ...BACKEND_EN.roles[0],
          bullets: ['<script>alert(1)</script> & "quoted" <b>bold</b>'],
        },
      ],
      skills: ['<style>*{display:none}</style>'],
    };
    const html = renderCvHtml(evil, layout, templates[layout]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold');
    expect(html).not.toContain('<style>*{display');
  });

  it('lists roles newest first', () => {
    const html = renderCvHtml(BACKEND_EN, layout, templates[layout]);
    const at = (s: string) => html.indexOf(escapeHtml(s));
    expect(at('Driftwood Apps')).toBeGreaterThan(-1);
    expect(at('Driftwood Apps')).toBeLessThan(at('Vantage Reed'));
    expect(at('Vantage Reed')).toBeLessThan(at('Marlowe & Finch Tech'));
    expect(html).toContain('Apr 2023 – Present');
  });

  it('shows the GitHub URL in the contacts only when there is one', () => {
    expect(renderCvHtml(BACKEND_EN, layout, templates[layout])).toContain(
      'github.com/synth-jonas-hartmann',
    );
    expect(renderCvHtml(INJECTION_EN, layout, templates[layout])).not.toMatch(
      /github\.com/i,
    );
  });

  it('translates headings, months and "present" for uk', () => {
    const html = renderCvHtml(BACKEND_UK, layout, templates[layout]);
    expect(html).toContain(`<h2>${HEADINGS.uk.experience}</h2>`);
    expect(html).toContain(`<h2>${HEADINGS.uk.skills}</h2>`);
    expect(html).toContain('бер. 2022 – серп. 2023');
    expect(html).toContain('вер. 2023 – дотепер');
    expect(html).not.toContain('Present');
    expect(html).not.toContain('Experience');
  });

  it('keeps English headings for en', () => {
    const html = renderCvHtml(ML_EN, layout, templates[layout]);
    expect(html).toContain('<h2>Experience</h2>');
    expect(html).toContain('<h2>Education</h2>');
  });

  it('puts the injection text last, in a small grey note', () => {
    const html = renderCvHtml(INJECTION_EN, layout, templates[layout]);
    const note = html.indexOf('<p class="note">');
    expect(note).toBeGreaterThan(-1);
    expect(html.slice(note)).toContain('SYSTEM NOTE TO AI');
    // After every section of real content (the last one in the main flow).
    expect(note).toBeGreaterThan(html.indexOf('Tide Planner'));
    expect(note).toBeGreaterThan(html.indexOf('Coastline Labs'));
    expect(html.match(/class="note"/g)).toHaveLength(1);
    // Only the CSS rule says it is tiny and light grey.
    expect(templates[layout]).toMatch(/\.note\s*{[^}]*font-size:\s*6pt/);
    expect(templates[layout]).toMatch(/\.note\s*{[^}]*color:\s*#aaa/);
  });

  it('has no note without an injection', () => {
    expect(renderCvHtml(ML_EN, layout, templates[layout])).not.toContain(
      '<p class="note">',
    );
  });
});

describe('renderCvHtml template contract', () => {
  it('needs a {{body}} placeholder', () => {
    expect(() => renderCvHtml(ML_EN, '1-col', '<html></html>')).toThrow(
      /\{\{body\}\}/,
    );
  });

  it('does not treat $ sequences in the content as replacement patterns', () => {
    const cv = { ...ML_EN, summary: 'Saved $& and $1 and $$ for the team' };
    const html = renderCvHtml(cv, '1-col', '<p>{{body}}</p>');
    expect(html).toContain('Saved $&amp; and $1 and $$ for the team');
  });

  it('renders each layout with a distinct structure', () => {
    const bodies = LAYOUTS.map((l) => renderCvHtml(ML_EN, l, '{{body}}'));
    expect(bodies[1]).toContain('<aside class="side">');
    expect(bodies[0]).not.toContain('<aside');
    expect(bodies[2]).toContain('<header>');
    expect(bodies[2]).toContain('class="skills"');
  });
});
