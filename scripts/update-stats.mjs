import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/activity.svg");
const placeholderMode = process.argv.includes("--placeholder");
const username = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;

if (!placeholderMode && !username) throw new Error("PROFILE_USERNAME or GITHUB_REPOSITORY_OWNER is required.");
if (!placeholderMode && !token) throw new Error("PROFILE_TOKEN or GITHUB_TOKEN is required.");

const query = async (source, variables) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-profile-readme-stats",
    },
    body: JSON.stringify({ query: source, variables }),
  });

  if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map(({ message }) => message).join("; "));
  return payload.data;
};

const profileQuery = `
  query Profile($login: String!) {
    user(login: $login) {
      contributionsCollection { contributionYears }
    }
  }
`;

const yearQuery = `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoryContributions
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

const utcYearRange = (year) => {
  const currentYear = new Date().getUTCFullYear();
  return {
    from: `${year}-01-01T00:00:00Z`,
    to: year === currentYear ? new Date().toISOString() : `${year}-12-31T23:59:59Z`,
  };
};

const longestStreak = (days) => {
  const active = days
    .filter((day) => day.contributionCount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let current = 0;
  let previous = null;

  for (const day of active) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const isNextDay = previous && date.getTime() - previous.getTime() === 86_400_000;
    current = isNextDay ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const point = (cx, cy, radius, index, total = 5) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
};

const pointsFor = (values, maxValue, cx, cy, radius) => values.map((value, index) => {
  const ratio = value === 0 ? 0 : Math.log10(value + 1) / Math.log10(maxValue + 1);
  return point(cx, cy, radius * Math.max(0.08, ratio), index).map((n) => n.toFixed(1)).join(",");
}).join(" ");

const compact = (value) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const render = ({ login, total, streak, year, metrics, pending = false }) => {
  const labels = ["Commits", "Issues", "Pull requests", "Reviews", "Repositories"];
  const values = [metrics.commits, metrics.issues, metrics.pullRequests, metrics.reviews, metrics.repositories];
  const cx = 760;
  const cy = 208;
  const radius = 135;
  const maxMetric = Math.max(...values, 10);
  const maxRing = 10 ** Math.ceil(Math.log10(maxMetric));
  const grid = [0.25, 0.5, 0.75, 1].map((ratio) =>
    `<polygon points="${Array.from({ length: 5 }, (_, i) => point(cx, cy, radius * ratio, i).map((n) => n.toFixed(1)).join(",")).join(" ")}" />`
  ).join("");
  const axes = Array.from({ length: 5 }, (_, i) => {
    const [x, y] = point(cx, cy, radius, i);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
  }).join("");
  const labelNodes = labels.map((label, i) => {
    const [x, y] = point(cx, cy, radius + 38, i);
    const anchor = x < cx - 20 ? "end" : x > cx + 20 ? "start" : "middle";
    const dy = i === 0 ? -2 : 5;
    return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="radar-label">${label}<tspan x="${x.toFixed(1)}" dy="18" class="radar-value">${compact(values[i])}</tspan></text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="440" viewBox="0 0 1000 440" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity for ${escapeXml(login)}</title>
  <desc id="desc">${total} total contributions, ${streak} day longest streak, and a radar chart of contribution types.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0a0f1f"/><stop offset="1" stop-color="#17112a"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#22d3ee"/><stop offset=".52" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>
      text { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .eyebrow { fill:#8b96ad; font-size:14px; letter-spacing:2px; text-transform:uppercase; }
      .big { fill:#f8fafc; font-size:42px; font-weight:750; }
      .label { fill:#9aa7bd; font-size:15px; }
      .radar-label { fill:#cbd5e1; font-size:14px; font-weight:600; }
      .radar-value { fill:#67e8f9; font-size:12px; font-weight:500; }
      .grid polygon, .grid line { fill:none; stroke:#526078; stroke-width:1; opacity:.48; }
      .shape { transform-box:fill-box; transform-origin:center; animation:grow 1s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes grow { from { transform:scale(.05); opacity:0 } to { transform:scale(1); opacity:1 } }
    </style>
  </defs>
  <rect x="1" y="1" width="998" height="438" rx="24" fill="url(#bg)" stroke="#27334a" stroke-width="2"/>
  <rect x="34" y="32" width="932" height="3" rx="1.5" fill="url(#accent)"/>
  <text x="54" y="75" class="eyebrow">GITHUB · ${escapeXml(login)}</text>
  <text x="54" y="122" fill="#f8fafc" font-size="25" font-weight="700">Activity snapshot</text>
  <text x="54" y="151" class="label">All-time progress + ${year} contribution mix</text>
  <line x1="490" y1="70" x2="490" y2="370" stroke="#27334a"/>

  <text x="54" y="219" class="big">${total.toLocaleString("en-US")}</text>
  <text x="54" y="246" class="label">total contributions</text>
  <text x="283" y="219" class="big">${streak}</text>
  <text x="283" y="246" class="label">day longest streak</text>

  <rect x="54" y="286" width="382" height="70" rx="14" fill="#111a2c" stroke="#27334a"/>
  <circle cx="82" cy="321" r="7" fill="#67e8f9" filter="url(#glow)"/>
  <text x="103" y="316" fill="#dbeafe" font-size="15" font-weight="600">Contribution radar</text>
  <text x="103" y="339" class="label">Log scale up to ${compact(maxRing)} · updated automatically</text>

  <g class="grid">${grid}${axes}</g>
  <polygon class="shape" points="${pointsFor(values, maxRing, cx, cy, radius)}" fill="url(#accent)" fill-opacity=".38" stroke="#67e8f9" stroke-width="2.5" filter="url(#glow)"/>
  ${labelNodes}
  ${pending ? '<rect x="545" y="178" width="430" height="62" rx="14" fill="#0a0f1f" fill-opacity=".92" stroke="#8b5cf6"/><text x="760" y="205" text-anchor="middle" fill="#f8fafc" font-size="15" font-weight="650">Live data will appear after the first workflow run</text><text x="760" y="226" text-anchor="middle" class="label">Actions → Update profile activity → Run workflow</text>' : ""}
  <text x="54" y="404" class="label">Data source: GitHub GraphQL API</text>
  <text x="946" y="404" text-anchor="end" class="label">generated ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;
};

let stats;

if (placeholderMode) {
  stats = {
    login: "YOUR_USERNAME",
    total: 0,
    streak: 0,
    year: new Date().getUTCFullYear(),
    metrics: { commits: 0, issues: 0, pullRequests: 0, reviews: 0, repositories: 0 },
    pending: true,
  };
} else {
  const profile = await query(profileQuery, { login: username });
  if (!profile.user) throw new Error(`GitHub user '${username}' was not found.`);

  const currentYear = new Date().getUTCFullYear();
  const years = [...new Set(profile.user.contributionsCollection.contributionYears)].sort((a, b) => a - b);
  const yearly = [];

  for (const year of years) {
    const data = await query(yearQuery, { login: username, ...utcYearRange(year) });
    yearly.push({ year, ...data.user.contributionsCollection });
  }

  const current = yearly.find(({ year }) => year === currentYear) ?? yearly.at(-1);
  const days = yearly.flatMap(({ contributionCalendar }) => contributionCalendar.weeks.flatMap(({ contributionDays }) => contributionDays));
  stats = {
    login: username,
    total: yearly.reduce((sum, item) => sum + item.contributionCalendar.totalContributions, 0),
    streak: longestStreak(days),
    year: currentYear,
    metrics: {
      commits: current.totalCommitContributions,
      issues: current.totalIssueContributions,
      pullRequests: current.totalPullRequestContributions,
      reviews: current.totalPullRequestReviewContributions,
      repositories: current.totalRepositoryContributions,
    },
  };
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, render(stats), "utf8");
console.log(`Updated ${outputPath}`);

