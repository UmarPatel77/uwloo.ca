// Goals for "Optimal plan": what someone wants out of their degree, as words the course search
// (site/search/rank.js) can find courses by. A topic ("machine learning", "public policy") or a textbook's contents
// work as they are. A career or a role ("lawyer", "SWE", "classics professor") isn't in course descriptions, so a
// short list of the topics it usually takes stands in for it; those lists are this file's, and the dialog shows
// them so they can be changed.

/** [what it matches, its name, the topics it stands for] */
const GOALS = [
  [/\b(swe|software (engineer|engineering|developer|development|dev)|programmer|coder|coding|developer|web dev\w*|full ?stack|back ?end|front ?end)\b/, 'software engineering', 'software engineering, software design, algorithms, data structures, programming, databases, operating systems, computer networks, software testing'],
  [/\b(data scien\w*|data analyst|data analytics|data engineer\w*|analytics)\b/, 'data science', 'statistics, data analysis, machine learning, regression, data visualization, databases, probability, programming'],
  [/\b(ml|ai|machine learning engineer|ai engineer|artificial intelligence)\b/, 'machine learning', 'machine learning, artificial intelligence, neural networks, statistics, linear algebra, optimization, probability'],
  [/\b(quant|quantitative (analyst|finance|trader)|trader|trading)\b/, 'quantitative finance', 'stochastic calculus, probability, financial mathematics, derivatives, statistics, numerical methods, time series'],
  [/\b(investment bank\w*|banker|banking|finance|financial analyst|wealth management|private equity|venture capital)\b/, 'finance', 'corporate finance, investments, valuation, financial accounting, financial markets, securities, economics'],
  [/\b(accountant|accounting|cpa|auditor|audit\w*|tax\w*)\b/, 'accounting', 'financial accounting, managerial accounting, auditing, taxation, accounting information systems'],
  [/\b(actuary|actuarial)\b/, 'actuarial science', 'actuarial science, probability, statistics, financial mathematics, life contingencies, risk management'],
  [/\b(economist|economics research)\b/, 'economics', 'microeconomics, macroeconomics, econometrics, economic theory, game theory, economic policy'],
  [/\b(lawyer|law school|law|legal|attorney|paralegal|judge|lsat)\b/, 'law', 'law, legal studies, legal reasoning, rights, constitution, criminal justice, ethics, argumentation, logic'],
  [/\b(doctor|physician|med school|medical school|medicine|pre ?med|mcat|surgeon)\b/, 'medicine', 'physiology, anatomy, biochemistry, cell biology, genetics, organic chemistry, biomedical ethics, psychology'],
  [/\b(pharmacist|pharmacy)\b/, 'pharmacy', 'pharmacology, biochemistry, organic chemistry, physiology, drugs, microbiology'],
  [/\b(nurse|nursing)\b/, 'nursing', 'physiology, anatomy, health, nutrition, psychology, microbiology, health care'],
  [/\b(dentist|dentistry|dental)\b/, 'dentistry', 'anatomy, physiology, biochemistry, cell biology, microbiology, organic chemistry'],
  [/\b(optometrist|optometry)\b/, 'optometry', 'vision science, optics, physiology, anatomy, biochemistry, ocular'],
  [/\b(physiotherap\w*|physio|kinesiologist|athletic therap\w*)\b/, 'physiotherapy', 'kinesiology, biomechanics, anatomy, exercise physiology, motor control, rehabilitation'],
  [/\b(psychologist|therapist|counsell?or|counsell?ing|clinical psych\w*)\b/, 'psychology', 'clinical psychology, abnormal psychology, counselling, developmental psychology, cognition, research methods'],
  [/\b(social work\w*)\b/, 'social work', 'social work, social welfare, social policy, sociology, community, counselling'],
  [/\b(teacher|teaching|educator|education|teachers college|b ?ed)\b/, 'teaching', 'education, teaching, learning, curriculum, educational psychology, child development, communication'],
  [/\b(policy analyst|public servant|civil servant|government|politician|public policy|diplomat|foreign service)\b/, 'public policy', 'public policy, political science, policy analysis, public administration, governance, economics, international relations'],
  [/\b(journalis\w*|reporter|writer|author|editor|publishing|copywrit\w*)\b/, 'writing', 'writing, journalism, rhetoric, editing, media, communication, literature'],
  [/\b(product manag\w*|pm)\b/, 'product management', 'product management, user experience, software engineering, business strategy, marketing, communication'],
  [/\b(ux|ui|user experience|interaction design\w*|product design\w*|hci)\b/, 'user experience', 'user experience, interface design, human-computer interaction, usability, design, psychology'],
  [/\b(game dev\w*|game design\w*|video games?)\b/, 'game development', 'game design, computer graphics, programming, software development, interactive media'],
  [/\b(cyber ?security|security engineer|ethical hack\w*|infosec)\b/, 'cybersecurity', 'computer security, cryptography, computer networks, operating systems'],
  [/\b(entrepreneur\w*|startups?|founder)\b/, 'entrepreneurship', 'entrepreneurship, innovation, venture, business strategy, marketing, finance, product'],
  [/\b(marketing|marketer|advertising|brand manag\w*)\b/, 'marketing', 'marketing, consumer behaviour, advertising, communication, market research, statistics'],
  [/\b(consultant|consulting|management consult\w*)\b/, 'consulting', 'business strategy, management, economics, finance, organizational behaviour, data analysis, communication'],
  [/\b(urban plann\w*|city plann\w*|planner)\b/, 'urban planning', 'urban planning, land use, transportation, housing, geographic information systems, municipal'],
  [/\b(environmental consult\w*|sustainability|climate|conservation\w*)\b/, 'environment', 'climate change, sustainability, ecology, environmental policy, environmental science, geographic information systems'],
  [/\b(architect)\b/, 'architecture', 'architecture, design studio, building, history of architecture, urban design'],
  [/\b(museum|curator|archivist|librarian)\b/, 'museums and archives', 'history, art history, archives, heritage, material culture, museums'],
  [/\b(translator|interpreter)\b/, 'languages', 'translation, linguistics, language, grammar, literature'],
  [/\b(classics|classicist)\b/, 'classics', 'classical studies, latin, greek, ancient greece, ancient rome, mythology, ancient history'],
  [/\b(latin(?! america)|ancient greek|greek(?! life)|ancient languages?)\b/, 'classical languages', 'latin, greek, classical studies, ancient greece, ancient rome'],
  [/\b(theory|theoretical|proofs?|pure)\b/, 'theory', 'theory, proofs, foundations, abstract, rigorous'],
  [/\b(applied|hands ?on|practical|projects?|industry)\b/, 'applied', 'applications, projects, design, practical, laboratory'],
  [/\b(research|grad school|graduate school|phd|masters|academia)\b/, 'research', 'research methods, seminar, advanced topics, theory'],
];
// Words about the goal rather than its subject: left out of the search, which would find them in descriptions
// ("teacher" in French courses for teacher candidates).
const ROLE = /\b(i|im|i'm|want|wanna|would|like|to|be|become|becoming|a|an|the|as|in|at|for|of|and|or|with|my|career|careers|job|jobs|work|working|professor|prof|lecturer|scholar|academic|researcher|student|students|non|still|maybe|goal|goals|field|role|position|future|someday|eventually|get|into|go|going|school|major|minor)\b/g;

/**
 * A goal → what to search for: {query, names}. "SWE" → software engineering's topics; "classics professor" →
 * classics's; "machine learning" or a textbook's contents → itself. The goal's own words that aren't about a role
 * stay in; names: the goals it matched, to show what it's searching for.
 */
export function goalQuery(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { query: '', names: [] };
  // "non-math student": not a topic to look for.
  const norm = ` ${raw
    .toLowerCase()
    .replace(/\bnon[- ]?[a-z]+/g, ' ')
    .replace(/[^a-z0-9+#'’&\s-]/g, ' ')
    .replace(/(\w)-(\w)/g, '$1 $2')
    .replace(/\s+/g, ' ')} `;
  const names = [];
  const topics = [];
  let rest = norm;
  for (const [re, name, list] of GOALS) {
    const g = new RegExp(re.source, 'g');
    if (!g.test(norm)) continue;
    names.push(name);
    topics.push(list);
    rest = rest.replace(new RegExp(re.source, 'g'), ' ');
  }
  // Long text (a textbook's contents) is searched as it is.
  if (raw.split(/\s+/).length > 12) return { query: raw, names: [] };
  const own = rest
    .replace(/\b(high|secondary|elementary|primary|middle) school\b/g, ' ')
    .replace(ROLE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const query = [...topics, own].filter(Boolean).join(', ');
  return { query: query || raw, names };
}
