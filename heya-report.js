// @ts-check
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  LevelFormat,
  ShadingType,
  PageBreak,
  HeadingLevel,
  convertInchesToTwip,
} = require('docx');
const { writeFileSync } = require('fs');
const { join } = require('path');

// ─── Dates ───────────────────────────────────────────────────────────────────
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

const pad = (n) => String(n).padStart(2, '0');
const YESTERDAY_DATE = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
const DISPLAY_DATE = today.toLocaleDateString('en-ZA', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const OUTPUT_FILE = join(process.cwd(), `Heya_Daily_Report_${YESTERDAY_DATE}.docx`);

// ─── Brand colours (no # prefix for docx) ───────────────────────────────────
const C = {
  BLUE: '3D7CC9',
  GREEN: '3BB54A',
  PURPLE: '8B3DAF',
  AMBER: 'E07B00',
  GREY: '666666',
  CREAM: 'FFF8E7',
  LIGHT_PURPLE: 'F5EBF8',
  WHITE: 'FFFFFF',
  BLACK: '000000',
  LIGHT_GREY: 'F2F2F2',
};

// ─── Step 1: Fetch yesterday's EOD emails via M365 MCP ───────────────────────
async function fetchEmails(client) {
  console.log('📬  Fetching yesterday\'s EOD emails via M365 MCP…');

  const messages = [
    {
      role: 'user',
      content: `Search Outlook for emails with "Daily Summary Report" in the subject that were received on ${YESTERDAY_DATE}.
For each email found, extract:
1. The sender's full name
2. The sender's role/title (from their email signature if available)
3. The full plain-text body of the email

Return the results as a JSON array with objects like:
{
  "name": "...",
  "role": "...",
  "body": "..."
}

If no emails are found, return an empty array [].`,
    },
  ];

  // Agentic loop — keep going until stop_reason is "end_turn"
  while (true) {
    const response = await client.beta.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      tools: [
        {
          type: 'mcp',
          server_label: 'm365',
          server_url: 'https://microsoft365.mcp.claude.com/mcp',
          // Pass the M365 access token as an auth header if available
          ...(process.env.M365_ACCESS_TOKEN
            ? {
                authorization_token: process.env.M365_ACCESS_TOKEN,
              }
            : {}),
        },
      ],
      messages,
      betas: ['mcp-client-2025-04-04'],
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract the JSON from the final text block
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock) return [];

      const match = textBlock.text.match(/\[[\s\S]*\]/);
      if (!match) {
        console.warn('⚠️  Could not parse email JSON from response. Continuing with empty list.');
        return [];
      }
      try {
        return JSON.parse(match[0]);
      } catch {
        console.warn('⚠️  JSON parse failed. Continuing with empty list.');
        return [];
      }
    }

    // Handle tool_use blocks — pass results back
    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          // The MCP server handles execution; we just acknowledge
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: block.type === 'tool_use' ? JSON.stringify({ error: 'tool executed by MCP server' }) : '',
          });
        }
      }
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    } else {
      // Unexpected stop reason — bail
      break;
    }
  }

  return [];
}

// ─── Step 2: Synthesise executive summary ────────────────────────────────────
async function synthesizeSummary(client, emails) {
  console.log('🧠  Synthesising executive summary…');

  const emailsText =
    emails.length === 0
      ? 'No EOD emails were received yesterday.'
      : emails
          .map(
            (e, i) =>
              `--- Email ${i + 1} ---\nFrom: ${e.name} (${e.role || 'Role unknown'})\n\n${e.body}`,
          )
          .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: `You are preparing a daily executive briefing for Yehuda Lazarus, CEO of Heya — a South African BPO company.

Today's date: ${DISPLAY_DATE}
Yesterday's date: ${YESTERDAY_DATE}

Here are yesterday's EOD team reports:

${emailsText}

Synthesise a crisp executive summary. Return ONLY a valid JSON object (no markdown, no explanation) with exactly these fields:

{
  "intro": "2-3 sentences. Professional but warm. References yesterday specifically. No hollow phrases like 'I hope this finds you well'.",
  "teamWins": ["4-6 specific achievements from yesterday — concrete, with names/numbers where possible"],
  "challenges": [
    { "issue": "Specific problem or blocker", "owner": "Person or team responsible" }
  ],
  "needsYehuda": ["Items requiring CEO input, decision, or awareness — be specific"],
  "tomorrow": ["4-6 forward-looking items on the radar for today"]
}

Rules:
- teamWins: 4-6 items, each a complete sentence with specifics
- challenges: 3-5 items, ONLY "issue" and "owner" fields — no suggestions, no next steps
- needsYehuda: omit entirely (use []) if nothing genuinely needs CEO attention
- tomorrow: 4-6 items, forward-looking and actionable
- If no emails were provided, create a placeholder summary noting no reports were received`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text in synthesis response');

  // Strip any markdown code fences
  const cleaned = textBlock.text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  return JSON.parse(cleaned);
}

// ─── Step 3: Build and save the .docx ────────────────────────────────────────
function buildDocument(summary, emails) {
  console.log('📄  Building Word document…');

  // ── Numbering config for proper Word bullet lists ──────────────────────────
  const NUMBERING = {
    config: [
      {
        reference: 'heya-bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.25) },
              },
              run: { font: 'Arial', size: 22 },
            },
          },
        ],
      },
    ],
  };

  // ── Helper: bullet paragraph ───────────────────────────────────────────────
  const bullet = (text, color = C.BLACK) =>
    new Paragraph({
      numbering: { reference: 'heya-bullets', level: 0 },
      spacing: { after: 80 },
      children: [
        new TextRun({
          text,
          font: 'Arial',
          size: 22,
          color,
        }),
      ],
    });

  // ── Helper: section label ──────────────────────────────────────────────────
  const sectionLabel = (text, color) =>
    new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({
          text: text.toUpperCase(),
          font: 'Arial',
          size: 22,
          bold: true,
          color,
        }),
      ],
    });

  // ── Helper: blue horizontal rule ──────────────────────────────────────────
  const blueRule = () =>
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 8, color: C.BLUE },
      },
      spacing: { after: 240 },
      children: [],
    });

  // ── Helper: challenge card (amber) ────────────────────────────────────────
  const challengeCard = (item) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: {
                top: { style: BorderStyle.SINGLE, size: 12, color: C.AMBER },
                bottom: { style: BorderStyle.NIL },
                left: { style: BorderStyle.NIL },
                right: { style: BorderStyle.NIL },
              },
              shading: { type: ShadingType.CLEAR, fill: C.CREAM },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  spacing: { after: 60 },
                  children: [
                    new TextRun({ text: 'Issue: ', font: 'Arial', size: 20, bold: true, color: C.AMBER }),
                    new TextRun({ text: item.issue, font: 'Arial', size: 20 }),
                  ],
                }),
                new Paragraph({
                  spacing: { after: 0 },
                  children: [
                    new TextRun({ text: 'Owner: ', font: 'Arial', size: 20, bold: true }),
                    new TextRun({ text: item.owner, font: 'Arial', size: 20 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

  // ── Helper: spacer after table ────────────────────────────────────────────
  const spacer = (pts = 120) =>
    new Paragraph({ spacing: { after: pts }, children: [] });

  // ── Helper: needsYehuda card (purple left border) ─────────────────────────
  const needsCard = (text) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      margins: { top: 80, bottom: 80, left: 0, right: 0 },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: {
                top: { style: BorderStyle.NIL },
                bottom: { style: BorderStyle.NIL },
                left: { style: BorderStyle.SINGLE, size: 24, color: C.PURPLE },
                right: { style: BorderStyle.NIL },
              },
              shading: { type: ShadingType.CLEAR, fill: C.LIGHT_PURPLE },
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  spacing: { after: 0 },
                  children: [new TextRun({ text, font: 'Arial', size: 20 })],
                }),
              ],
            }),
          ],
        }),
      ],
    });

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 1 — Executive view
  // ────────────────────────────────────────────────────────────────────────────
  const page1 = [
    // HEYA masthead
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'HEYA',
          font: 'Arial',
          size: 72,
          bold: true,
          color: C.BLUE,
        }),
      ],
    }),
    // Subtitle
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'Daily Team Report',
          font: 'Arial',
          size: 28,
          color: C.GREY,
        }),
      ],
    }),
    // Date + preparer
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `${DISPLAY_DATE}  ·  Prepared by Dean Ormsby (COO)`,
          font: 'Arial',
          size: 18,
          color: C.GREY,
          italics: true,
        }),
      ],
    }),
    // Blue rule
    blueRule(),

    // Intro
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: summary.intro, font: 'Arial', size: 22 })],
    }),

    // ── What We Achieved Yesterday ──────────────────────────────────────────
    sectionLabel('What We Achieved Yesterday', C.GREEN),
    ...(summary.teamWins || []).map((win) => bullet(win, C.BLACK)),
    spacer(200),

    // ── Challenges ──────────────────────────────────────────────────────────
    sectionLabel('Challenges', C.AMBER),
    ...(summary.challenges || []).flatMap((item) => [challengeCard(item), spacer(100)]),
    spacer(100),

    // ── Needs Your Input or Decision ────────────────────────────────────────
    ...(summary.needsYehuda && summary.needsYehuda.length > 0
      ? [
          sectionLabel('Needs Your Input or Decision', C.PURPLE),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'The following items require your attention.',
                font: 'Arial',
                size: 20,
                italics: true,
                color: C.GREY,
              }),
            ],
          }),
          ...(summary.needsYehuda || []).flatMap((item) => [needsCard(item), spacer(100)]),
          spacer(100),
        ]
      : []),

    // ── On the Radar for Today ───────────────────────────────────────────────
    sectionLabel('On the Radar for Today', C.BLUE),
    ...(summary.tomorrow || []).map((item) => bullet(item, C.BLACK)),
    spacer(240),

    // Closing line
    new Paragraph({
      spacing: { after: 0 },
      children: [
        new TextRun({
          text: 'Detailed breakdown by team member follows below.',
          font: 'Arial',
          size: 20,
          italics: true,
          color: C.GREY,
        }),
      ],
    }),
  ];

  // ────────────────────────────────────────────────────────────────────────────
  // PAGE 2 — Team detail
  // ────────────────────────────────────────────────────────────────────────────
  const page2 = [
    // Page break paragraph
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];

  if (emails.length === 0) {
    page2.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: 'No team reports were received for yesterday.',
            font: 'Arial',
            size: 22,
            italics: true,
            color: C.GREY,
          }),
        ],
      }),
    );
  } else {
    for (const email of emails) {
      // Name + role header
      page2.push(
        new Paragraph({
          spacing: { before: 240, after: 60 },
          children: [
            new TextRun({
              text: email.name || 'Unknown',
              font: 'Arial',
              size: 28,
              bold: true,
              color: C.BLUE,
            }),
            new TextRun({
              text: email.role ? `  —  ${email.role}` : '',
              font: 'Arial',
              size: 22,
              italics: true,
              color: C.GREY,
            }),
          ],
        }),
      );

      // Thin grey rule under name
      page2.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: C.LIGHT_GREY },
          },
          spacing: { after: 120 },
          children: [],
        }),
      );

      // Parse body into sections/bullets
      const bodyLines = (email.body || '').split('\n');
      for (const line of bodyLines) {
        const trimmed = line.trim();
        if (!trimmed) {
          page2.push(spacer(60));
          continue;
        }

        // Detect subheadings: lines ending in ":" or ALL CAPS short lines
        const isHeading =
          (trimmed.endsWith(':') && trimmed.length < 60) ||
          (trimmed === trimmed.toUpperCase() && trimmed.length < 60 && /[A-Z]/.test(trimmed));

        if (isHeading) {
          page2.push(
            new Paragraph({
              spacing: { before: 160, after: 80 },
              children: [
                new TextRun({
                  text: trimmed,
                  font: 'Arial',
                  size: 20,
                  bold: true,
                  color: C.GREY,
                }),
              ],
            }),
          );
        } else if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
          page2.push(bullet(trimmed.replace(/^[-•*]\s*/, '')));
        } else {
          page2.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: trimmed, font: 'Arial', size: 20 })],
            }),
          );
        }
      }

      page2.push(spacer(200));
    }
  }

  // ── Assemble document ───────────────────────────────────────────────────────
  const doc = new Document({
    numbering: NUMBERING,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 in DXA
            margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 },
          },
        },
        children: [...page1, ...page2],
      },
    ],
  });

  const buffer = Packer.toBuffer(doc);
  buffer.then((buf) => {
    writeFileSync(OUTPUT_FILE, buf);
    console.log(`\n✅  Report saved to: ${OUTPUT_FILE}`);
  });

  return buffer;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌  ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const emails = await fetchEmails(client);
    console.log(`   Found ${emails.length} EOD report(s).`);

    const summary = await synthesizeSummary(client, emails);
    console.log('   Summary synthesised.');

    await buildDocument(summary, emails);
  } catch (err) {
    console.error('❌  Error:', err.message || err);
    process.exit(1);
  }
}

main();
