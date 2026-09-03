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

const render = ({ login, total, streak, metrics, pending = false }) => {
  const labels = ["Commits", "Issues", "Pull requests", "Reviews", "Repositories"];
  const values = [metrics.commits, metrics.issues, metrics.pullRequests, metrics.reviews, metrics.repositories];
  const cx = 750;
  const cy = 128;
  const radius = 78;
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
    const [x, y] = point(cx, cy, radius + 28, i);
    const anchor = x < cx - 16 ? "end" : x > cx + 16 ? "start" : "middle";
    const dy = i === 0 ? 0 : 3;
    return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" class="radar-label">${label}<tspan x="${x.toFixed(1)}" dy="14" class="radar-value">${compact(values[i])}</tspan></text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="264" viewBox="0 0 1000 264" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity for ${escapeXml(login)}</title>
  <desc id="desc">${total} total contributions, ${streak} day longest streak, and a radar chart of contribution types.</desc>
  <defs>
    <style>
      text { font-family:"Ubuntu Mono","Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
      .eyebrow { fill:#60a5fa; font-size:13px; font-weight:700; letter-spacing:1.4px; }
      .big { fill:#eff6ff; font-size:32px; font-weight:700; }
      .label { fill:#7890b0; font-size:13px; }
      .radar-label { fill:#c7d7eb; font-size:12px; font-weight:600; }
      .radar-value { fill:#60a5fa; font-size:11px; font-weight:500; }
      .grid polygon, .grid line { fill:none; stroke:#29476d; stroke-width:1; opacity:.7; }
      .shape { transform-box:fill-box; transform-origin:center; animation:grow .55s ease-out both; }
      @keyframes grow { from { transform:scale(.1); opacity:0 } to { transform:scale(1); opacity:1 } }
    </style>
  </defs>
  <rect x="1" y="1" width="998" height="262" rx="15" fill="#080f1d" stroke="#2563eb" stroke-width="2"/>
  <text x="32" y="35" class="eyebrow">GITHUB ACTIVITY · ${escapeXml(login)}</text>
  <text x="32" y="58" class="label">all-time progress / all-time contribution mix</text>
  <line x1="480" y1="24" x2="480" y2="238" stroke="#1e3a5f"/>

  <rect x="32" y="80" width="198" height="100" rx="10" fill="#0b1628" stroke="#1e3a5f"/>
  <text x="50" y="124" class="big">${total.toLocaleString("en-US")}</text>
  <text x="50" y="150" class="label">total contributions</text>
  <path d="M50 164H212" stroke="#1e3a5f"/>
  <text x="50" y="174" class="eyebrow" font-size="10">ALL TIME</text>

  <rect x="246" y="80" width="198" height="100" rx="10" fill="#0b1628" stroke="#1e3a5f"/>
  <text x="264" y="124" class="big">${streak}</text>
  <text x="264" y="150" class="label">day longest streak</text>
  <path d="M264 164H426" stroke="#1e3a5f"/>
  <text x="264" y="174" class="eyebrow" font-size="10">BEST RUN</text>

  <circle cx="39" cy="215" r="4" fill="#3b82f6"/>
  <text x="52" y="219" class="label">radar uses a log scale up to ${compact(maxRing)}</text>

  <g class="grid">${grid}${axes}</g>
  <polygon class="shape" points="${pointsFor(values, maxRing, cx, cy, radius)}" fill="#2563eb" fill-opacity=".28" stroke="#60a5fa" stroke-width="2"/>
  ${labelNodes}
  ${pending ? '<rect x="548" y="99" width="404" height="54" rx="9" fill="#080f1d" fill-opacity=".96" stroke="#2563eb"/><text x="750" y="122" text-anchor="middle" fill="#dbeafe" font-size="13" font-weight="700">Waiting for the first workflow run</text><text x="750" y="141" text-anchor="middle" class="label">Actions → Update profile activity</text>' : ""}
  <text x="968" y="246" text-anchor="end" class="label">GitHub GraphQL · ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;
};

let stats;

if (placeholderMode) {
  stats = {
    login: "YOUR_USERNAME",
    total: 0,
    streak: 0,
    metrics: { commits: 0, issues: 0, pullRequests: 0, reviews: 0, repositories: 0 },
    pending: true,
  };
} else {
  const profile = await query(profileQuery, { login: username });
  if (!profile.user) throw new Error(`GitHub user '${username}' was not found.`);

  const years = [...new Set(profile.user.contributionsCollection.contributionYears)].sort((a, b) => a - b);
  const yearly = [];

  for (const year of years) {
    const data = await query(yearQuery, { login: username, ...utcYearRange(year) });
    yearly.push({ year, ...data.user.contributionsCollection });
  }

  const days = yearly.flatMap(({ contributionCalendar }) => contributionCalendar.weeks.flatMap(({ contributionDays }) => contributionDays));
  const sumMetric = (field) => yearly.reduce((sum, item) => sum + item[field], 0);
  stats = {
    login: username,
    total: yearly.reduce((sum, item) => sum + item.contributionCalendar.totalContributions, 0),
    streak: longestStreak(days),
    metrics: {
      commits: sumMetric("totalCommitContributions"),
      issues: sumMetric("totalIssueContributions"),
      pullRequests: sumMetric("totalPullRequestContributions"),
      reviews: sumMetric("totalPullRequestReviewContributions"),
      repositories: sumMetric("totalRepositoryContributions"),
    },
  };
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, render(stats), "utf8");
console.log(`Updated ${outputPath}`);
