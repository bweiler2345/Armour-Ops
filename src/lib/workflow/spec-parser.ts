// Reads the workflow sections of docs/PRODUCT_SPEC.md into a simple outline
// so tests can compare the approved-workflow data with the spec word for word.
// It understands only the Markdown the spec uses: headings, paragraphs,
// bullet and numbered lists, and blockquotes.

export type SpecNode =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string };

export type SpecSubsection = { heading: string; nodes: SpecNode[] };

export type SpecStep = {
  number: number;
  title: string;
  intro: SpecNode[];
  subsections: SpecSubsection[];
};

export type SpecStage = {
  heading: string;
  intro: SpecNode[];
  steps: SpecStep[];
};

const WORKFLOW_START = /^# (Stage \d+: |Owner Milestone: |Completion Work)/;

export function parseWorkflowSpec(markdown: string): SpecStage[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const stages: SpecStage[] = [];
  let stage: SpecStage | null = null;
  let step: SpecStep | null = null;
  let subsection: SpecSubsection | null = null;
  let inWorkflow = false;

  const target = (): SpecNode[] | null =>
    subsection ? subsection.nodes : step ? step.intro : stage ? stage.intro : null;

  const pushListItem = (ordered: boolean, item: string) => {
    const nodes = target();
    if (!nodes) return;
    const last = nodes.at(-1);
    if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
    else nodes.push({ type: "list", ordered, items: [item] });
  };

  let previousBlank = true;
  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("# ")) {
      inWorkflow = WORKFLOW_START.test(line);
      step = null;
      subsection = null;
      stage = null;
      if (inWorkflow) {
        stage = { heading: line.slice(2), intro: [], steps: [] };
        stages.push(stage);
      }
      previousBlank = true;
      continue;
    }
    if (!inWorkflow || !stage) continue;

    const stepMatch = line.match(/^## Step (\d+): (.+)$/);
    if (stepMatch) {
      step = { number: Number(stepMatch[1]), title: stepMatch[2], intro: [], subsections: [] };
      stage.steps.push(step);
      subsection = null;
      previousBlank = true;
      continue;
    }
    if (line.startsWith("### ")) {
      subsection = { heading: line.slice(4), nodes: [] };
      step?.subsections.push(subsection);
      previousBlank = true;
      continue;
    }

    if (line.trim() === "") {
      previousBlank = true;
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    const numbered = line.match(/^\d+\. (.+)$/);
    if (bullet) pushListItem(false, bullet[1]);
    else if (numbered) pushListItem(true, numbered[1]);
    else if (line.startsWith("> ")) target()?.push({ type: "quote", text: line.slice(2) });
    else {
      const nodes = target();
      const last = nodes?.at(-1);
      if (!previousBlank && last?.type === "paragraph") last.text += ` ${line.trim()}`;
      else nodes?.push({ type: "paragraph", text: line.trim() });
    }
    previousBlank = false;
  }

  return stages;
}
