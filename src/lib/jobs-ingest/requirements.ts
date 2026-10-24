import type { Evidence, NormalizedJob } from "./contract";
import { quote } from "./text";

/**
 * Deterministic requirements extraction for Match Engine scoring. No AI.
 *
 * Output keeps exactly the four arrays the Resume Speed scorer consumes
 * (`computeJobFitScore`): requiredSkills, preferredSkills, techStack, domainKeywords.
 * Terms come only from a curated vocabulary, so nothing is invented; every term
 * carries an evidence quote (internal, never returned to clients).
 *
 * Context decides the list:
 * - "Requirements / Qualifications / About you" sections → required (skills) or techStack (tech)
 * - "Preferred / Nice to have / Bonus" sections or "…is a plus" sentences → preferredSkills
 * - "Responsibilities / The role" sections → techStack (tech) and domainKeywords (domain)
 * - Company intro, benefits, pay, EEO and legal text → ignored
 * - Clauses that negate a requirement ("no SQL experience required") contribute nothing.
 * A term found as both required and preferred is required.
 */
export const REQUIREMENTS_EXTRACTOR_VERSION = "requirements-v2";

export type Requirements = NonNullable<NormalizedJob["requirements"]>;

type Kind = "tech" | "skill" | "domain";
type Term = { name: string; kind: Kind; re: RegExp };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Word-boundary pattern that also works for terms like C++, C#, .NET, CI/CD. */
const bound = (alts: string[], flags = "i") =>
  new RegExp(
    `(?<![A-Za-z0-9+#])(?:${alts.map(esc).join("|")})(?![A-Za-z0-9+#])`,
    flags,
  );

// [canonical, kind, alternates?, case-sensitive?]
const VOCAB: [string, Kind, string[]?, boolean?][] = [
  // Languages
  ["Python", "tech"],
  ["Java", "tech"],
  ["JavaScript", "tech", ["JavaScript", "Javascript", "ES6"]],
  ["TypeScript", "tech"],
  ["C++", "tech", ["C++", "C/C++", "Cpp"]],
  ["C#", "tech"],
  [".NET", "tech", [".NET", "dotnet"]],
  ["Rust", "tech", ["Rust"], true],
  ["Scala", "tech", ["Scala"], true],
  ["Kotlin", "tech"],
  ["Swift", "tech", ["Swift", "SwiftUI"], true],
  ["Objective-C", "tech", ["Objective-C", "Objective C"]],
  ["Ruby", "tech", ["Ruby"], true],
  ["Ruby on Rails", "tech", ["Ruby on Rails", "Rails"], true],
  ["PHP", "tech"],
  ["Elixir", "tech"],
  ["Haskell", "tech"],
  ["Perl", "tech"],
  ["Bash", "tech", ["Bash", "shell scripting"]],
  ["SQL", "tech", ["SQL"], true],
  ["MATLAB", "tech"],
  ["SAS", "tech", ["SAS"], true],
  ["Stata", "tech"],
  ["Solidity", "tech"],
  ["Verilog", "tech", ["Verilog", "SystemVerilog"]],
  ["VHDL", "tech"],
  ["CUDA", "tech"],
  // Frameworks / libraries
  ["React", "tech", ["React", "React.js", "ReactJS"], true],
  ["React Native", "tech"],
  ["Next.js", "tech", ["Next.js", "NextJS"]],
  ["Node.js", "tech", ["Node.js", "NodeJS"]],
  ["Vue.js", "tech", ["Vue", "Vue.js", "VueJS"]],
  ["Angular", "tech", ["Angular", "AngularJS"], true],
  ["Svelte", "tech"],
  ["Django", "tech"],
  ["Flask", "tech", ["Flask"], true],
  ["FastAPI", "tech"],
  ["Spring Boot", "tech", ["Spring Boot", "Spring Framework"]],
  ["GraphQL", "tech"],
  ["gRPC", "tech"],
  [
    "REST APIs",
    "tech",
    [
      "REST",
      "RESTful",
      "REST APIs",
      "REST API",
      "restful",
      "rest APIs",
      "rest API",
    ],
    true,
  ],
  ["Flutter", "tech"],
  ["PyTorch", "tech"],
  ["TensorFlow", "tech"],
  ["JAX", "tech", ["JAX"], true],
  ["scikit-learn", "tech", ["scikit-learn", "sklearn"]],
  ["pandas", "tech", ["pandas"], true],
  ["NumPy", "tech"],
  ["Hugging Face", "tech", ["Hugging Face", "HuggingFace"]],
  ["HTML", "tech", ["HTML", "HTML5"], true],
  ["CSS", "tech", ["CSS", "CSS3", "Tailwind"], true],
  // Data / infra
  ["PostgreSQL", "tech", ["PostgreSQL", "Postgres"]],
  ["MySQL", "tech"],
  ["MongoDB", "tech"],
  ["Redis", "tech", ["Redis"], true],
  ["Cassandra", "tech"],
  ["DynamoDB", "tech"],
  ["Elasticsearch", "tech"],
  ["BigQuery", "tech"],
  ["Redshift", "tech"],
  ["Snowflake", "tech", ["Snowflake"], true],
  ["Databricks", "tech"],
  ["Apache Spark", "tech", ["Apache Spark", "PySpark", "Spark"], true],
  ["Apache Kafka", "tech", ["Kafka"], true],
  ["Apache Airflow", "tech", ["Airflow"], true],
  ["dbt", "tech", ["dbt"], true],
  ["Hadoop", "tech"],
  ["Flink", "tech"],
  ["Trino", "tech", ["Trino"], true],
  ["Presto", "tech", ["Presto"], true],
  ["ClickHouse", "tech"],
  ["AWS", "tech", ["AWS", "Amazon Web Services"]],
  ["GCP", "tech", ["GCP", "Google Cloud"]],
  ["Azure", "tech", ["Azure"], true],
  ["Kubernetes", "tech", ["Kubernetes", "K8s"]],
  ["Docker", "tech"],
  ["Terraform", "tech"],
  ["Ansible", "tech"],
  ["Helm", "tech", ["Helm charts", "Helm"], true],
  ["Linux", "tech"],
  ["Git", "tech", ["Git", "GitHub", "GitLab"], true],
  ["CI/CD", "tech", ["CI/CD", "continuous integration"]],
  ["Jenkins", "tech", ["Jenkins CI", "Jenkins pipelines", "Jenkins"], true],
  ["GitHub Actions", "tech"],
  ["Prometheus", "tech"],
  ["Grafana", "tech"],
  ["Datadog", "tech"],
  ["Splunk", "tech"],
  ["iOS", "tech", ["iOS"], true],
  ["Android", "tech", ["Android"], true],
  // Analytics / business tools
  ["Excel", "skill", ["Excel", "Microsoft Excel", "MS Excel"], true],
  ["Tableau", "tech"],
  ["Looker", "tech", ["Looker"], true],
  ["Power BI", "tech", ["Power BI", "PowerBI"]],
  ["Salesforce", "tech"],
  ["HubSpot", "tech"],
  ["Marketo", "tech"],
  ["Google Analytics", "tech"],
  ["Workday", "tech"],
  ["NetSuite", "tech"],
  ["SAP", "tech", ["SAP"], true],
  ["Jira", "tech"],
  ["Figma", "tech"],
  ["Adobe Creative Suite", "tech"],
  ["Photoshop", "tech"],
  ["Illustrator", "tech", ["Illustrator"], true],
  ["Zendesk", "tech"],
  // Skills / practices
  ["machine learning", "skill", ["machine learning", "ML"]],
  ["deep learning", "skill"],
  ["large language models", "skill", ["LLM", "LLMs", "large language models"]],
  [
    "natural language processing",
    "skill",
    ["NLP", "natural language processing"],
  ],
  ["computer vision", "skill"],
  ["reinforcement learning", "skill"],
  [
    "statistics",
    "skill",
    ["statistics", "statistical analysis", "statistical modeling"],
  ],
  ["A/B testing", "skill", ["A/B testing", "A/B tests"]],
  ["experimentation", "skill"],
  ["data modeling", "skill", ["data modeling", "data modelling"]],
  ["ETL", "skill", ["ETL", "ELT"]],
  ["data pipelines", "skill"],
  ["distributed systems", "skill"],
  ["microservices", "skill"],
  ["system design", "skill"],
  ["API design", "skill"],
  ["data analysis", "skill", ["data analysis", "data analytics"]],
  ["data visualization", "skill"],
  ["financial modeling", "skill"],
  ["FP&A", "skill"],
  ["GAAP", "skill", ["GAAP", "US GAAP"]],
  ["SOX", "skill", ["SOX", "Sarbanes-Oxley"], true],
  ["CPA", "skill", ["CPA"], true],
  ["accounting", "skill"],
  ["underwriting", "skill"],
  ["forecasting", "skill"],
  ["project management", "skill"],
  ["product management", "skill"],
  ["program management", "skill"],
  ["Agile", "skill", ["Agile", "Scrum"], true],
  ["stakeholder management", "skill"],
  ["account management", "skill"],
  ["negotiation", "skill"],
  ["enterprise sales", "skill"],
  ["pipeline generation", "skill", ["pipeline generation", "prospecting"]],
  ["customer success", "skill"],
  ["technical writing", "skill"],
  ["user research", "skill", ["user research", "UX research"]],
  ["prototyping", "skill"],
  ["design systems", "skill"],
  ["accessibility", "skill"],
  ["SEO", "skill", ["SEO"], true],
  ["copywriting", "skill"],
  [
    "recruiting",
    "skill",
    ["recruiting", "full-cycle recruiting", "technical recruiting"],
  ],
  ["penetration testing", "skill"],
  ["threat modeling", "skill"],
  ["incident response", "skill"],
  ["networking", "skill", ["TCP/IP", "network engineering"]],
  [
    "embedded systems",
    "skill",
    ["embedded systems", "embedded software", "firmware"],
  ],
  ["CAD", "skill", ["CAD", "SolidWorks"], true],
  ["PCB design", "skill"],
  ["FPGA", "skill"],
  ["robotics", "skill"],
  ["supply chain", "skill"],
  ["Six Sigma", "skill"],
  // Domains
  ["fintech", "domain"],
  ["payments", "domain"],
  ["banking", "domain"],
  ["lending", "domain"],
  ["insurance", "domain"],
  ["fraud", "domain"],
  ["healthcare", "domain", ["healthcare", "health care"]],
  ["clinical", "domain"],
  ["e-commerce", "domain", ["e-commerce", "ecommerce"]],
  ["marketplace", "domain"],
  ["advertising", "domain", ["advertising", "ads platform", "adtech"]],
  ["cybersecurity", "domain", ["cybersecurity", "security engineering"]],

  [
    "autonomous vehicles",
    "domain",
    ["autonomous vehicles", "self-driving", "autonomous driving"],
  ],
  ["developer tools", "domain", ["developer tools", "developer experience"]],
  ["B2B SaaS", "domain"],
  ["SaaS", "domain"],
  ["crypto", "domain", ["crypto", "blockchain", "web3"]],
  ["gaming", "domain"],
  ["aerospace", "domain"],
  ["defense", "domain"],

  ["real estate", "domain"],
];

// One-letter/common-word languages count only inside a list or after "in/with/using":
// "Python, Go, or Rust" ✓ · "Go deep on problems" ✗ · "R&D" ✗.
const listed = (word: string) =>
  new RegExp(
    `(?:(?<=[,(/]\\s?)|(?<=\\b(?:in|with|and|or|using|like|including|e\\.g\\.)\\s))${word}(?![A-Za-z0-9+#&-])`,
  );
const TERMS: Term[] = [
  ...VOCAB.map(([name, kind, alts, cs]) => ({
    name,
    kind,
    re: bound(alts ?? [name], cs ? "" : "i"),
  })),
  {
    name: "Go",
    kind: "tech",
    re: new RegExp(`\\bGolang\\b|${listed("Go").source}`),
  },
  { name: "R", kind: "tech", re: listed("R") },
];

type Section = "required" | "preferred" | "role" | "intro" | "ignore";

function headingSection(line: string): Section | null {
  const t = line
    .replace(/[‘’]/g, "'")
    .replace(/^#+\s*/, "")
    .replace(/[:•\-–—*#]+\s*$/, "")
    .trim();
  if (
    t.length === 0 ||
    t.length > 80 ||
    /[.!?]$/.test(t) ||
    t.split(/\s+/).length > 10
  )
    return null;
  // A short unpunctuated requirement is still content, e.g. "Experience with Python".
  // Company headings remain headings even when the employer is also a product name.
  if (!/^about\s/i.test(t) && TERMS.some((term) => term.re.test(t)))
    return null;
  if (
    /\b(preferred|nice[- ]to[- ]haves?|bonus|pluses|ideally|desired|good to have|extra credit|stand out|added advantage)\b/i.test(
      t,
    )
  )
    return "preferred";
  if (
    /\b(requirements?|qualifications?|what you('ll)? (need|bring)|you (have|bring|might be|are)|about you|who you are|must[- ]haves?|minimum|skills|we('re| are) looking for|ideal candidate|what we('re)? look(ing)? for|experience)\b/i.test(
      t,
    )
  )
    return "required";
  if (
    /\b(responsibilities|what you('ll)? (do|work on|build|own)|the role|about the (role|job|team|position|opportunity)|in this role|day[- ]to[- ]day|your impact|the opportunity|the team|what you will)\b/i.test(
      t,
    )
  )
    return "role";
  if (
    /\b(about (us|[A-Z][\w&.]*)|benefits|perks|what we offer|compensation|pay|salary|equal|eeo|diversity|privacy|accommodations?|values|culture|mission|why (join|work)|life at|who we are|how we work|location|hybrid|remote|disclosure|notice|our commitment)\b/i.test(
      t,
    )
  )
    return "ignore";
  return null;
}

const PREFERRED_CUE =
  /\b(nice to have|is a plus|are a plus|a plus|a bonus|is a bonus|bonus points|preferred|preferably|ideally|desirable|optional|not required but|(?:helpful|useful|beneficial) but not required)\b/i;
const REQUIRED_CUE =
  /\b(required|mandatory|essential|must have|must be|need to have|you have|you bring|experience (with|in|building|using|developing)|proficien\w*|knowledge of|familiar(ity)? with|expertise in|background in|fluency in|fluent in|hands-on|strong (understanding|skills?|background|experience))\b/i;
const NEGATED =
  /\bno\b[^.;]{0,100}\b(required|needed|necessary)\b|\bnot (required|necessary|needed|mandatory|preferred|a requirement)\b|\bno (need|requirement)\b|\b(?:don'?t|do not) (need|require|use)\b|\bdoesn'?t require\b|\bdoes not require\b|\b(?:isn|aren)'?t (required|necessary|needed)\b|\bwithout (prior|any|using) |^not\s+(?!only\b)/i;
const BOILERPLATE =
  /\b(equal (employment )?opportunity|without regard to|accommodations?|e-?verify|privacy (policy|notice)|background checks?|pay (range|transparency)|base salary|total compensation|benefits include|401\(?k\)?|medical, dental|talent acquisition (representative|partner|team)|recruit(ing|er|ers|ment) (process|team|partner|fraud)|interviewing for this role|automated employment decision|AEDT|notice (for|to) [\w ]{0,40}applicants)\b/i;
/** "Bachelor's degree in Robotics, Statistics…" names a field of study, not a skill. */
const DEGREE =
  /\b(degree|bachelor'?s|master'?s|ph\.?d|B\.?S\.?|M\.?S\.?|BA|MBA)\b[^.]{0,40}\b(in|of)\b/;

/** Split independently qualified clauses, but retain lists like "Python, SQL and AWS preferred". */
function requirementClauses(sentence: string): string[] {
  const cue = (text: string) =>
    REQUIRED_CUE.test(text) || PREFERRED_CUE.test(text) || NEGATED.test(text);
  const qualifiedLeft = (text: string) =>
    /\b(?:required|mandatory|essential|must have|must be|preferred|preferably|optional|a plus|a bonus)\b/i.test(
      text,
    ) || NEGATED.test(text);
  for (const separator of sentence.matchAll(
    /,\s*|\s+(?:and|but|while|whereas|although)\s+/gi,
  )) {
    const left = sentence.slice(0, separator.index).trim();
    const right = sentence.slice(separator.index + separator[0].length).trim();
    if (!TERMS.some((term) => term.re.test(right))) continue;
    const contrast = /\b(?:but|while|whereas|although)\b/i.test(separator[0]);
    // "Experience with Python and SQL preferred" qualifies the whole list.
    // Split a conjunction only when the preceding clause has its own qualifier.
    if (
      (qualifiedLeft(left) && cue(right)) ||
      (contrast && (cue(left) || cue(right)))
    )
      return [...requirementClauses(left), ...requirementClauses(right)];
  }
  return [sentence];
}

type TermMatch = { term: Term; text: string; index: number };
function termMatches(text: string): TermMatch[] {
  const matches = TERMS.flatMap((term) =>
    [...text.matchAll(new RegExp(term.re.source, `${term.re.flags}g`))].map(
      (match) => ({
        term,
        text: match[0],
        index: match.index,
      }),
    ),
  ).sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  // React Native is one stated technology; it does not independently require React web.
  const distinct: TermMatch[] = [];
  for (const match of matches) {
    if (distinct.some((prior) => match.index < prior.index + prior.text.length))
      continue;
    distinct.push(match);
  }
  return distinct;
}

function ambiguousMention(
  match: TermMatch,
  sentence: string,
  company: string,
): boolean {
  const before = sentence.slice(0, match.index);
  const after = sentence.slice(match.index + match.text.length);
  if (
    match.term.name === "Excel" &&
    /^\s+(?:at|in)\s+(?:working|communicating|collaborating|building|leading|a|an|the)\b/i.test(
      after,
    )
  )
    return true;
  if (match.term.name === "Excel" && /^\s+at\b/i.test(after)) return true;
  if (
    match.term.name === "React" &&
    /^\s+(?:(?:quickly|calmly|promptly|appropriately)\s+)?to\b/i.test(after)
  )
    return true;
  if (!match.term.re.test(company)) return false;
  // A company mention is not tool experience. Explicit usage/knowledge still counts
  // when the named employer also makes the tool (e.g. "experience with Snowflake").
  if (/\b(?:at|for|join|represent|about|within)\s*$/i.test(before)) return true;
  if (
    /^(?:['’]s)?\s+(?:customers?|teams?|employees?|partners?|colleagues?|sales|leadership|business|brand|mission|culture|values|offices?|recruiters?|people|product and engineering)\b/i.test(
      after,
    )
  )
    return true;
  const toolContext =
    /\b(?:experience|expertise|proficiency|proficient|familiarity|familiar|knowledge|fluency|fluent|skilled)\b[^.;]{0,60}\b(?:with|in|of)\b[^.;]{0,75}$/i.test(
      before,
    ) ||
    /\b(?:using|implementing|administering|configuring|programming in|developing (?:in|with)|(?:use|usage) of)\b[^.;]{0,75}$/i.test(
      before,
    );
  const toolRole =
    /^\s+(?:developer|engineer|architect|administrator|consultant)\b/i.test(
      after,
    );
  return !toolContext && !toolRole;
}

function evidenceQuote(sentence: string, match: TermMatch): string {
  // Keep the actual matched term in the capped evidence, including near a long line's end.
  const start = Math.max(0, match.index - 120);
  return quote(
    sentence.length <= 300 ? sentence : sentence.slice(start, start + 300),
  );
}

export function extractRequirements(
  title: string,
  descriptionText: string,
  company: string,
): { requirements: Requirements | null; evidence: Evidence[] } {
  const found = new Map<
    string,
    { kind: Kind; list: keyof Requirements; quote: string; section: string }
  >();
  const rank: Record<keyof Requirements, number> = {
    requiredSkills: 4,
    techStack: 3,
    domainKeywords: 2,
    preferredSkills: 1,
  };
  const put = (
    match: TermMatch,
    list: keyof Requirements,
    sentence: string,
    section: string,
  ) => {
    const { term } = match;
    if (ambiguousMention(match, sentence, company)) return;
    const prior = found.get(term.name);
    // Required beats preferred; tech required stays tech.
    if (prior && rank[prior.list] >= rank[list]) return;
    found.set(term.name, {
      kind: term.kind,
      list,
      quote: evidenceQuote(sentence, match),
      section,
    });
  };
  const scan = (sentence: string, section: Section) => {
    const normalized = sentence.replace(/[‘’]/g, "'");
    if (section === "ignore" || BOILERPLATE.test(normalized)) return;
    const positiveOptional =
      /\b(?:preferred|helpful|useful|beneficial|desirable|a plus|a bonus|optional)\b/i.test(
        normalized,
      ) &&
      /\bnot (?:required|necessary|needed)\b/i.test(normalized) &&
      !/\bnot preferred\b/i.test(normalized);
    if (NEGATED.test(normalized) && !positiveOptional) return;
    const preferred =
      positiveOptional ||
      PREFERRED_CUE.test(normalized) ||
      (section === "preferred" &&
        !/\b(required|mandatory|essential|must have)\b/i.test(normalized));
    const requiredLike = section === "required" || REQUIRED_CUE.test(sentence);
    const degree = DEGREE.test(sentence);
    for (const match of termMatches(sentence)) {
      const { term } = match;
      if (degree && term.kind !== "tech") continue;
      if (preferred) {
        put(match, "preferredSkills", sentence, section);
        continue;
      }
      if (term.kind === "domain") {
        if (section !== "intro")
          put(match, "domainKeywords", sentence, section);
        continue;
      }
      if (requiredLike)
        put(
          match,
          term.kind === "tech" ? "techStack" : "requiredSkills",
          sentence,
          section,
        );
      else if (section === "role" && term.kind === "tech")
        put(match, "techStack", sentence, section);
    }
  };
  // The title states the core of the role ("Senior Python Engineer", "Payments Risk Analyst").
  for (const match of termMatches(title)) {
    const { term } = match;
    put(
      match,
      term.kind === "domain"
        ? "domainKeywords"
        : term.kind === "tech"
          ? "techStack"
          : "requiredSkills",
      title,
      "title",
    );
  }

  let section: Section = "intro";
  for (const rawLine of descriptionText.split("\n")) {
    const bullet = /^\s*(?:[•*+-]|\d+[.)])\s+/;
    let line = rawLine.replace(bullet, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const inlineHeading =
      colon > 0 ? headingSection(line.slice(0, colon)) : null;
    if (inlineHeading) {
      section = inlineHeading;
      line = line.slice(colon + 1).trim();
      if (!line) continue;
    }
    const heading = headingSection(line);
    if (heading && !bullet.test(rawLine)) {
      section = heading;
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?;])\s+/))
      if (sentence.length <= 600)
        for (const clause of requirementClauses(sentence))
          scan(clause, section);
  }

  const requirements: Requirements = {
    requiredSkills: [],
    preferredSkills: [],
    techStack: [],
    domainKeywords: [],
  };
  const evidence: Evidence[] = [];
  for (const [name, f] of found) {
    if (requirements[f.list].length >= 30) continue;
    requirements[f.list].push(name);
    evidence.push({
      field: "requirements",
      value: `${f.list}:${name}`,
      quote: f.quote,
      method: f.section === "title" ? "title" : "text-pattern",
      sourceField: f.section === "title" ? "title" : `description:${f.section}`,
    });
  }
  for (const list of Object.values(requirements))
    list.sort((a, b) => a.localeCompare(b));
  const total = Object.values(requirements).reduce((n, l) => n + l.length, 0);
  // No vocabulary term found → unknown (null), so the UI hides the score instead of showing 0.
  return total
    ? { requirements, evidence }
    : { requirements: null, evidence: [] };
}
