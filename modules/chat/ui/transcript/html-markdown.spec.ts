import { htmlSource, htmlToMarkdown } from './html-markdown';

describe('htmlToMarkdown', () => {
  it('turns paragraphs, headings and inline marks into markdown', () => {
    expect(
      htmlToMarkdown(
        '<h2>Alerts</h2><p><em>Set</em> as of <time>May 1</time>, <strong>by hand</strong><br>not listed.</p>',
      ),
    ).toBe('## Alerts\n\n*Set* as of May 1, **by hand**  \nnot listed.');
  });

  it('turns a table into a markdown table, a cell on one line', () => {
    expect(
      htmlToMarkdown(
        '<table><thead><tr><th>Component</th><th>Alert</th></tr></thead><tbody>' +
          '<tr><td><p>API</p></td><td><p>SEV3 Kafka | outage</p></td></tr>' +
          '<tr><td><p>Redis</p></td></tr></tbody></table>',
      ),
    ).toBe('| Component | Alert |\n| --- | --- |\n| API | SEV3 Kafka \\| outage |\n| Redis |  |');
  });

  it('turns lists, nested ones indented', () => {
    expect(htmlToMarkdown('<ul><li>One<ol><li>Inner</li></ol></li><li>Two</li></ul>')).toBe(
      '- One\n  1. Inner\n- Two',
    );
  });

  it('keeps code as it is', () => {
    expect(htmlToMarkdown('<p>Run <code>a*b</code></p><pre>x = 1\n```\n</pre>')).toBe(
      'Run `a*b`\n\n````\nx = 1\n```\n````',
    );
  });

  it('escapes markdown in text', () => {
    expect(htmlToMarkdown('<p># not a *heading* &lt;b&gt;</p>')).toBe(
      '\\# not a \\*heading\\* \\<b\\>',
    );
  });

  it('keeps a web link and drops any other', () => {
    expect(
      htmlToMarkdown(
        '<p><a href="https://x.dev/a b">site</a> <a href="javascript:alert(1)">bad</a></p>',
      ),
    ).toBe('[site](<https://x.dev/a%20b>) bad');
  });

  it('leaves no trace of scripts, styles, frames, handlers or image sources', () => {
    const markdown = htmlToMarkdown(
      '<p onclick="steal()">Hi<script>steal()</script><style>p{}</style></p>' +
        '<iframe src="https://evil.dev"></iframe><img src="https://evil.dev/x.png" onerror="steal()" alt="logo">',
    );
    expect(markdown).toBe('Hi\n\n\\[image: logo\\]');
  });

  it('keeps the text of elements it does not know', () => {
    expect(
      htmlToMarkdown(
        '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Note</p></ac:rich-text-body></ac:structured-macro>',
      ),
    ).toBe('Note');
  });
});

describe('htmlSource', () => {
  it('breaks the HTML onto lines after its blocks', () => {
    expect(htmlSource('<p>a</p><table><tr><td>b</td></tr></table>')).toBe(
      '<p>a</p>\n<table><tr><td>b</td></tr>\n</table>',
    );
  });
});
