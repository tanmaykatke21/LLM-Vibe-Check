"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ModelChip } from "@/components/ui";

/* ---------- small building blocks for readable docs ---------- */

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-[68ch] text-[15px] text-muted">{lead}</p>}
      <div className="mt-5 max-w-[68ch] space-y-4 text-[14.5px] leading-relaxed">{children}</div>
    </section>
  );
}
const H3 = ({ children }: { children: ReactNode }) => <h3 className="pt-2 text-[16px] font-semibold">{children}</h3>;

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="space-y-3">{items.map((it, i) => (
    <li key={i} className="flex gap-3"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{i + 1}</span><div>{it}</div></li>))}</ol>;
}

function Note({ kind = "tip", children }: { kind?: "tip" | "know" | "warn" | "tech"; children: ReactNode }) {
  const s = { tip: ["Tip", "border-accent/30 bg-accent-soft"], know: ["Good to know", "border-line-strong bg-paper"],
    warn: ["Watch out", "border-warn/30 bg-warn-soft"], tech: ["For developers", "border-line-strong bg-surface"] }[kind];
  return <div className={`rounded-xl border p-4 text-[13.5px] ${s[1]}`}><div className="mb-1 font-semibold">{s[0]}</div>{children}</div>;
}

const UI = ({ children }: { children: ReactNode }) => <span className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 text-[13px] font-medium">{children}</span>;
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-paper px-1 py-0.5 font-mono text-[12.5px]">{children}</code>;

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-[13.5px]">
    <thead className="bg-paper text-left text-[12.5px] text-muted"><tr>{head.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}</tbody></table></div>;
}

/** A tiny, static picture of a squad so readers can see what the builder shows. */
function MiniSquad() {
  const Box = ({ name, role, model }: { name: string; role: string; model: string }) => (
    <div className="w-[150px] rounded-lg border border-line-strong bg-surface p-2 text-left">
      <div className="text-[12px] font-semibold">{name}</div><div className="text-[11px] text-muted">{role}</div><ModelChip className="mt-1" model={model} />
    </div>);
  return (
    <figure className="rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Box name="Planner" role="planner" model="openai/gpt-5.4" /><span className="text-faint">→</span>
        <Box name="Executor" role="executor" model="google/gemini-3.1-pro-preview" /><span className="text-faint">→</span>
        <Box name="Reviewer" role="reviewer" model="anthropic/claude-sonnet-5.5" />
      </div>
      <figcaption className="mt-2 text-[12px] text-muted">A three-step squad. The planner writes a plan, the executor does the work, the reviewer checks it and can send it back for fixes. The colour shows which company made each model.</figcaption>
    </figure>);
}

/* ---------- table of contents ---------- */

const TOC: { id: string; title: string; keywords: string }[] = [
  { id: "what", title: "What LLMVibeCheck does", keywords: "about intro overview why" },
  { id: "quick-start", title: "Quick start in 5 steps", keywords: "start begin first tutorial" },
  { id: "words", title: "Words you'll see", keywords: "glossary token model prompt node role squad" },
  { id: "squads", title: "Build a squad", keywords: "builder node role model arrow connect template save canvas" },
  { id: "loops", title: "Feedback loops", keywords: "loop reviewer approved send back revise" },
  { id: "approval", title: "Approval steps", keywords: "checkpoint human approve edit reject pause" },
  { id: "tools", title: "Voice tools", keywords: "audio elevenlabs speech tts stt tool" },
  { id: "tasks", title: "Create a task", keywords: "task description rubric write job" },
  { id: "tests", title: "Hidden tests", keywords: "tests pytest coding pass rate correct" },
  { id: "skills", title: "Skills", keywords: "skill instructions style guide reuse" },
  { id: "run", title: "Run a squad", keywords: "run start live progress cost cap" },
  { id: "results", title: "Read a run's results", keywords: "trace output conversation cost time copy" },
  { id: "judging", title: "How runs are judged", keywords: "judge panel score complete partial failed quality cost" },
  { id: "verdict", title: "Add your own verdict", keywords: "human feedback stars rating" },
  { id: "fork", title: "Try a different model (fork)", keywords: "fork replay swap model reuse" },
  { id: "compare", title: "Compare squads", keywords: "leaderboard rank winner chart award cost cheapest fastest" },
  { id: "scores", title: "How scores are calculated", keywords: "overall score formula weights quality cheapest correct cost speed penalty" },
  { id: "reliability", title: "Check reliability (Run 3× more)", keywords: "repeat reliability success rate run again" },
  { id: "costs", title: "Costs and tokens", keywords: "money price dollars credits tokens" },
  { id: "help", title: "Troubleshooting", keywords: "error problem broken not working credits docker database" },
];

export default function Docs() {
  const [q, setQ] = useState(""); const [active, setActive] = useState("what");
  const shown = useMemo(() => { const s = q.trim().toLowerCase();
    return s ? TOC.filter(t => (t.title + " " + t.keywords).toLowerCase().includes(s)) : TOC; }, [q]);
  useEffect(() => {
    const obs = new IntersectionObserver(es => { const v = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id); },
      { rootMargin: "-80px 0px -70% 0px" });
    TOC.forEach(t => { const el = document.getElementById(t.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-8 md:grid-cols-[230px_1fr] md:px-6">
      <aside className="md:sticky md:top-16 md:h-[calc(100vh-5rem)] md:overflow-y-auto">
        <input aria-label="Search the docs" className="field" placeholder="Search, e.g. judge, cost, loop" value={q} onChange={e => setQ(e.target.value)} />
        <nav className="mt-3 space-y-0.5 text-[13.5px]">
          {shown.map(t => <a key={t.id} href={`#${t.id}`} aria-current={active === t.id ? "true" : undefined}
            className={`block rounded-md px-2 py-1.5 ${active === t.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface hover:text-ink"}`}>{t.title}</a>)}
          {shown.length === 0 && <p className="px-2 py-1.5 text-faint">Nothing matches “{q}”.</p>}
        </nav>
      </aside>

      <article className="min-w-0 space-y-10 pb-24">
        <header>
          <h1 className="text-[32px] font-semibold tracking-tight">LLMVibeCheck guide</h1>
          <p className="mt-2 max-w-[62ch] text-[15px] text-muted">Everything you can do in the app, explained in plain words. No coding needed, except in the boxes marked “For developers”, which you can skip.</p>
        </header>

        <Section id="what" title="What LLMVibeCheck does"
          lead="AI models like Claude, GPT and Gemini each have strengths. LLMVibeCheck lets you put several of them on one team, give the team a job, and measure which team does it best.">
          <p>Think of it like hiring. You assemble a small team, for example one model that plans, one that does the work and one that checks it. You give the team a task. LLMVibeCheck records everything the team does, what it cost and how long it took, and then scores the result.</p>
          <p>Run a few different teams on the same task and the Compare page tells you which one to use: the one that gets the job right for the least money and time.</p>
          <MiniSquad />
        </Section>

        <Section id="quick-start" title="Quick start in 5 steps" lead="Your first comparison takes about five minutes.">
          <Steps items={[
            <>Open <Link className="text-accent underline" href="/builder">Build</Link>. A three-step squad is already on the canvas.</>,
            <>Pick a task from the <UI>Choose a task…</UI> list at the top right, or create one with <UI>New task</UI> in the side panel.</>,
            <>Click <UI>Run squad</UI>. You'll watch each step light up as it works. Most runs finish in under a minute.</>,
            <>When it's done, click <UI>Judge this run</UI>. Hidden tests and three AI judges score the result.</>,
            <>Change a model or two, give the squad a new name, and run the same task again. Then open <Link className="text-accent underline" href="/compare">Compare</Link> to see which squad wins.</>,
          ]} />
          <Note kind="tip">Comparisons are only fair on the <b>same task</b>. Always run your squads on the same task before comparing them.</Note>
        </Section>

        <Section id="words" title="Words you'll see">
          <Table head={["Word", "What it means"]} rows={[
            [<b key="m">Model</b>, "An AI system that reads text and writes text, such as Claude Sonnet, GPT-5.4 or Gemini. Each one is made by a company and has its own price and strengths."],
            [<b key="s">Squad</b>, "A team of models (and sometimes tools or approval steps) working on one task, in an order you choose."],
            [<b key="n">Step (node)</b>, "One box in your squad. Each step is one model, one tool or one approval point."],
            [<b key="r">Role</b>, "The job a step does: planner, executor (does the work), reviewer, debugger, writer and so on. The role sets the step's starting instructions."],
            [<b key="p">Instructions (prompt)</b>, "The text a model is told before it starts. You can edit it for any step."],
            [<b key="t">Task</b>, "The job you give a squad, written in plain words. For example: “Write a function that converts “1h 30m” into seconds.”"],
            [<b key="k">Token</b>, "The unit models read and write in, roughly ¾ of a word. Models charge per token, so more tokens means a higher cost."],
            [<b key="j">Judge</b>, "An AI model asked to score the squad's work. LLMVibeCheck uses three judges from three different companies."],
            [<b key="h">Hidden test</b>, "An automatic check the squad never sees, for example “1h 30m must give 5400”. Used for coding tasks."],
          ]} />
        </Section>

        <Section id="squads" title="Build a squad" lead="The Build page is a canvas. Each box is a step; arrows show who passes work to whom.">
          <H3>Start from a template</H3>
          <p>Open <UI>Start from a template…</UI> in the top bar and pick one:</p>
          <Table head={["Template", "What it gives you"]} rows={[
            ["Plan, build, review", "Planner → executor → reviewer, run once in order."],
            ["With feedback loop", "Same three steps, but the reviewer can send work back to be fixed (see Feedback loops)."],
            ["With your approval", "Pauses after the plan so you can approve or edit it before work starts."],
            ["Voice round-trip", "Writes a script, turns it into speech, turns the speech back into text, then checks it."],
          ]} />
          <H3>Add a step</H3>
          <Steps items={[
            <>Choose a model in the model list next to <UI>Add model</UI>. Popular models are at the top; the rest are grouped by company.</>,
            <>Click <UI>Add model</UI>. A new box appears on the canvas and the view zooms to fit it.</>,
            <>Use <UI>Add tool</UI> for a voice tool, or <UI>Add approval</UI> for a point where you approve the work yourself.</>,
          ]} />
          <H3>Change a step</H3>
          <p>Click any box. The side panel lets you rename it, choose its <b>role</b>, swap its <b>model</b> (type in the search box, e.g. “gemini”), edit its <b>instructions</b>, tick <b>skills</b> and set an <b>answer length limit</b>. Click <UI>Remove</UI> to delete the step.</p>
          <H3>Connect steps</H3>
          <p>Each box has a dot on its left (work comes in) and on its right (work goes out). Drag from one box's right dot to another box's left dot to pass work along. To remove an arrow, click it and press Delete.</p>
          <p>Steps that don't depend on each other run at the same time, which saves time.</p>
          <H3>Save</H3>
          <p>Give your squad a name in the box at the top left and click <UI>Save</UI>. Squads are also saved automatically when you run them. Your saved squads are listed on the home page.</p>
          <Note kind="know">The coloured strip on each box shows the model's company: orange for Anthropic (Claude), green for OpenAI (GPT), blue for Google (Gemini). It makes mixed teams easy to read.</Note>
          <Note kind="warn">If something is wrong, for example a step with no model, a red bar explains it and <UI>Run squad</UI> stays disabled until you fix it.</Note>
        </Section>

        <Section id="loops" title="Feedback loops" lead="Let a reviewer send work back for fixes, like a teacher returning homework.">
          <p>Click the step that should be able to send work back (usually the reviewer). Under <b>Passes work to</b>, set <b>send back up to</b> to a number such as 2. The arrow becomes a dashed orange line underneath the boxes.</p>
          <p>When the reviewer is happy it starts its answer with the word <Code>APPROVED</Code> and the run moves on. Otherwise its comments go back to the earlier step, which tries again. This repeats at most the number of times you set, so a run can never loop forever.</p>
          <Note kind="tip">More loops can mean better work, but each loop costs money and time. On the Compare page you can see whether the extra loops were worth it.</Note>
        </Section>

        <Section id="approval" title="Approval steps" lead="Put yourself in the team. The run pauses and waits for you.">
          <p>Add an approval step with <UI>Add approval</UI> and connect it between two steps. When the run reaches it, a yellow banner appears on the run page showing the work so far. You can:</p>
          <ul className="list-disc space-y-1 pl-5"><li><UI>Approve</UI>: pass it on unchanged.</li><li><UI>Approve with my edits</UI>: change the text first, then pass it on.</li><li><UI>Stop the run</UI>: end it here.</li></ul>
          <p>If you don't answer, the step waits up to 30 minutes (you can change this) and then either approves or stops, whichever you chose for <b>If you don't answer</b>.</p>
          <Note kind="know">Every edit or stop is counted as <b>help needed</b>. A squad that needed your help scores a little lower than one that got it right alone.</Note>
        </Section>

        <Section id="tools" title="Voice tools" lead="Steps that aren't AI writers: they turn text into speech and speech back into text, using ElevenLabs.">
          <p><b>Text to speech</b> reads the previous step's text aloud and saves an audio file you can play on the run page. <b>Speech to text</b> listens to audio and writes down what it hears.</p>
          <p>The “Voice round-trip” template uses both, so a final model can check that nothing was lost in the conversion. Arrows that carry audio are purple.</p>
        </Section>

        <Section id="tasks" title="Create a task" lead="A task is the job you give a squad. Clear tasks give fair comparisons.">
          <Steps items={[
            <>On the Build page, open <UI>New task</UI> at the bottom of the side panel.</>,
            <>Give it a short title and describe exactly what you want back.</>,
            <>Choose a type (General, Coding or Audio) and click <UI>Create task</UI>. It's selected automatically for your next run.</>,
          ]} />
          <H3>Writing a good task</H3>
          <ul className="list-disc space-y-1 pl-5">
            <li>Say what the finished result looks like: “a 150-word product description with a headline”, not “write about our product”.</li>
            <li>List the rules: length, tone, format, things to include or avoid.</li>
            <li>For code, name the function and give two or three example inputs and outputs.</li>
          </ul>
          <Note kind="tip">Every squad gets exactly the same task text, so differences in results come from the team, not the instructions.</Note>
        </Section>

        <Section id="tests" title="Hidden tests" lead="For coding tasks, automatic checks decide whether the code really works. The squad never sees them.">
          <p>After a run, LLMVibeCheck takes the code from the final answer and runs it against the task's hidden tests, in a safe sandbox that can't reach your files or keys. You'll see a result such as <b>24/24 passed</b>.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>All tests pass</b>: the run is marked <b>Complete</b>.</li>
            <li><b>Some pass</b>: <b>Partial</b>.</li>
            <li><b>None pass</b>, or the code doesn't run at all: <b>Failed</b>.</li>
          </ul>
          <p>Tests are the strongest signal LLMVibeCheck has, because they check facts, not opinions. When a task has tests, they decide whether the run is complete.</p>
          <Note kind="tech">
            <p>Tests live in the task's <Code>test_cases</Code> field, in one of two forms:</p>
            <p className="mt-2"><b>pytest source</b>: <Code>{`{"code": "from solution import evaluate\\ndef test_add(): assert evaluate('1+2') == 3"}`}</Code>. Each test function counts once; parametrized tests count once per case. The squad's code is saved as <Code>solution.py</Code>.</p>
            <p className="mt-2"><b>Simple list</b>: <Code>{`[{"call": "parse('1h')", "expected": "3600"}]`}</Code>, one check per item.</p>
            <p className="mt-2">Code is taken from <Code>```python</Code>, <Code>```py</Code> or bare <Code>```</Code> blocks. Each run has a 30-second limit, and the sandbox receives no environment variables.</p>
          </Note>
        </Section>

        <Section id="skills" title="Skills" lead="Reusable instructions you write once and attach to any step, like a house style guide.">
          <Steps items={[
            <>Open <Link className="text-accent underline" href="/skills">Skills</Link>, give the skill a name and write the instructions, e.g. “Use type hints and docstrings.”</>,
            <>Click <UI>Add skill</UI>.</>,
            <>On the Build page, click a step and tick the skill under <b>Skills</b>. That step now follows those instructions.</>,
          ]} />
          <p>You can <UI>Edit</UI> or <UI>Delete</UI> a skill at any time. A skill that a squad still uses can't be deleted; untick it from those steps first.</p>
        </Section>

        <Section id="run" title="Run a squad" lead="Running sends the task through your squad, step by step, and records everything.">
          <p>Pick a task and click <UI>Run squad</UI>. You'll land on the run page, where:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Each box shows <b>Running</b>, <b>Done</b>, <b>Error</b> or <b>Waiting for you</b>.</li>
            <li>A progress bar shows how many steps have finished.</li>
            <li>Under each finished box: its cost, time and tokens.</li>
          </ul>
          <Note kind="know">To protect your budget, a run stops automatically if it costs more than $2. Each step also has a time limit of 2 minutes and a default answer length of about 1,500 tokens, which you can raise per step.</Note>
        </Section>

        <Section id="results" title="Read a run's results" lead="The run page shows what the team produced and how it got there.">
          <H3>Final output</H3>
          <p>The panel under the canvas shows the team's finished work. Code appears in its own box with a <UI>Copy</UI> button; <UI>Copy all</UI> copies everything. Drag the line above the panel, or use <UI>Expand</UI> and <UI>Collapse</UI>, to resize it.</p>
          <Note kind="know">If the last step is a reviewer, the final output is the work it approved, not the reviewer's comments.</Note>
          <H3>Trace tab</H3>
          <p>Click any box to see what that step was asked, what it answered for each attempt, its cost and time, and what the judges thought of it. Under <b>Conversation</b> you can follow every message between steps, in order.</p>
          <H3>Cost & time tab</H3>
          <p>Shows the total cost, a projection for 1,000 runs, total time, time spent waiting for you, and a bar for each step showing its share of the cost and time. The biggest bar is usually the first place to try a cheaper model.</p>
        </Section>

        <Section id="judging" title="How runs are judged" lead="Click Judge this run. Three things are checked, from most to least trustworthy.">
          <Table head={["Check", "Who does it", "What it decides"]} rows={[
            ["Hidden tests", "Automatic (coding tasks only)", "Whether the run is Complete, Partial or Failed."],
            ["Your verdict", "You, on the Evaluation tab", "Decides completion when there are no tests."],
            ["Judge panel", "Three AI models: Claude, GPT and Gemini", "A quality score out of 10, and completion when there are no tests or verdict."],
          ]} />
          <H3>Why three judges from three companies?</H3>
          <p>A model can be biased toward work written in its own style. Using judges from Anthropic, OpenAI and Google, and averaging them, cancels most of that out. Each judge also sees the hidden test results, so it can't call broken code perfect.</p>
          <p>The Evaluation tab shows each judge's score and reasoning. If they differ by 3 points or more you'll see <b>Judges disagree</b>, a sign that the result is debatable and worth reading yourself.</p>
          <p>The judges also score <b>each step</b> and say whether it did its job. That's how you spot, for example, a reviewer that rejected work which was already correct.</p>
          <Note kind="know">Judging costs about 2–5 cents per run and takes around 10 seconds. Without tests or a verdict from you, a run counts as complete when the judges average 7/10 or more and the majority say it's complete.</Note>
        </Section>

        <Section id="verdict" title="Add your own verdict" lead="You know what you wanted. Your rating counts too.">
          <p>On the Evaluation tab, choose 1 to 5 stars, tick <b>Task is complete</b> if it is, and say what's right or wrong, ideally naming the step that let it down. Click <UI>Submit verdict</UI>.</p>
          <p>An AI reads your comment and notes whether it was <b>useful</b> (specific), <b>vague</b> (“it's fine”) or <b>contradictory</b> (5 stars but “it's wrong”), which steps you blamed, and whether you agree with the judges.</p>
        </Section>

        <Section id="fork" title="Try a different model (fork)" lead="Change one step and re-run from there, without paying again for the steps before it.">
          <Steps items={[
            <>Open a finished run and click the step you want to change.</>,
            <>In <b>Try a different model from this step</b>, type a model name, or leave it empty to rerun with the same model.</>,
            <>Click <UI>Fork run</UI>. Steps before it are reused at $0; that step and everything after it run again.</>,
          ]} />
          <p>It's the cheapest way to answer “would a cheaper executor have been good enough?”. Forks are listed under <b>Forks of this run</b> on the Cost & time tab.</p>
        </Section>

        <Section id="compare" title="Compare squads" lead="Pick a task at the top of the Compare page to see every squad that ran it, side by side.">
          <Table head={["Part of the page", "What it tells you"]} rows={[
            ["Award cards", "Best overall, highest quality, cheapest, fastest and cheapest correct answer, with the margin over the runner-up. Click one to rank by it."],
            ["Squad chips", "Click a squad's chip to hide or show it everywhere on the page."],
            ["Rank by", "Re-order the leaderboard by Overall, Quality, Cheapest, Fastest, Cheapest correct or Fewest tokens."],
            ["Quality vs cost chart", "Each dot is a run. Top-left is best: high quality, low cost. The dashed line connects the best value choices."],
            ["Four small bar charts", "Quality, cost, time and tokens for every squad at a glance. ★ marks the best."],
            ["Where the money and time went", "For the selected squad: each step's share of cost and time, and which step to make cheaper first."],
            ["All parameters", "Every number in one table. Click a column to sort."],
          ]} />
          <Note kind="tip">Click any squad in the leaderboard, chart or table to see its breakdown and an <UI>Open run</UI> link.</Note>
        </Section>

        <Section id="scores" title="How scores are calculated" lead="Every score is out of 100 and can never be negative.">
          <H3>Quality (out of 100)</H3>
          <p>The average of whatever checks exist for the run: the judge panel's score (×10), the share of hidden tests passed (×100) and your star rating (1 star = 0, 5 stars = 100). Tests and judges count equally; your rating counts half as much by default.</p>
          <H3>Overall (out of 100)</H3>
          <p><b>Overall = Quality, reduced for being pricier, slower or needing more help than the best squad on the same task.</b> With the default settings:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Costing twice as much as the cheapest squad takes away up to 10% (half of the 20% cost weight).</li>
            <li>Being twice as slow as the fastest squad takes away up to 5% (half of the 10% speed weight).</li>
            <li>Each time you had to edit or stop the work takes away about 3%.</li>
          </ul>
          <p>So a squad that fails scores close to 0 however cheap it is, and the best, cheapest and fastest squad scores 100. Change the weights under <b>How the overall score works</b> at the bottom of the Compare page.</p>
          <H3>Cheapest correct answer</H3>
          <p>What you'd actually pay, on average, to get one correct answer: <b>average cost per run ÷ share of runs that were correct</b>. A squad that never got it right shows “never”. Use this when correctness is all that matters.</p>
        </Section>

        <Section id="reliability" title="Check reliability (Run 3× more)" lead="One good run can be luck. Repeat runs show how often a squad gets it right.">
          <p>On the Compare page, select a squad and click <UI>Run 3× more</UI> in its breakdown. It runs the same squad on the same task three more times (five at most per click) and judges each run automatically. Progress shows on the page.</p>
          <p>Each squad then shows how many of its judged runs were correct, for example <b>2/4 correct</b>, and its cost per correct answer updates.</p>
          <Note kind="warn">Each extra run costs the same as a normal run plus judging. Squads with an approval step will pause on every run until you approve.</Note>
        </Section>

        <Section id="costs" title="Costs and tokens" lead="You pay the model companies (through OpenRouter) for the tokens your squads use.">
          <p>Every model has a price per million tokens read (input) and written (output). Prices are shown next to each model in the model list. LLMVibeCheck adds up the real cost of every step and shows it everywhere: on each box, on the run page, and on Compare.</p>
          <Table head={["Typical", "Rough cost"]} rows={[
            ["A small model running a 3-step squad", "under 1 cent"],
            ["A mid-size model running a 3-step squad", "2–5 cents"],
            ["Judging one run with the 3-judge panel", "2–5 cents"],
          ]} />
          <p><b>Per 1,000 runs</b> on the Cost & time tab shows what a squad would cost if you used it at scale. That's often what decides between two squads that are equally good.</p>
        </Section>

        <Section id="help" title="Troubleshooting">
          <Table head={["You see", "What it means and what to do"]} rows={[
            ["“The backend isn't reachable” on the home page", "The server isn't running. Ask whoever set up LLMVibeCheck to start it (it runs on port 8000)."],
            ["“The database isn't” on the home page", "The database has stopped, often after the computer slept. In a terminal run: docker start squad-db"],
            ["“out of OpenRouter credits” / error 402", "The account that pays for the models is empty. Top it up at openrouter.ai/credits, then run again."],
            ["A step says “no answer: the model used its whole token budget on reasoning”", "Some models think before answering and ran out of space. Raise that step's answer length limit, e.g. to 6000."],
            ["The run says “Waiting for you”", "An approval step is waiting. Scroll to the yellow banner on the run page and approve, edit or stop."],
            ["“Judges disagree”", "The three judges scored more than 3 points apart. Read their reasoning on the Evaluation tab and add your own verdict."],
            ["Run squad is greyed out", "The red bar above the canvas lists what to fix, for example a step with no model."],
            ["You can't delete a squad or task", "It has runs, and is kept so past results stay comparable. Skills that a squad still uses can't be deleted either."],
          ]} />
          <Note kind="tech">Backend: <Code>uvicorn app.main:app --reload --port 8000</Code> from the <Code>backend</Code> folder. Health check: <Code>localhost:8000/health</Code> reports both the server and the database. Test suite: <Code>python -m pytest -q</Code>.</Note>
        </Section>
      </article>
    </main>
  );
}


