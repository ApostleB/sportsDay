// 투표 결과 계산. DB와 무관한 순수 함수이며 익명 투표에는 이름을 넣지 않는다

const byKo = (a, b) => a.localeCompare(b, 'ko');

function tally({ anonymous, options, answers, voterCount }) {
  const percent = (n) => (voterCount ? Math.round((n * 100) / voterCount) : 0);
  const namesOf = (list) => (anonymous ? [] : list.map((a) => a.name).sort(byKo));

  const rows = options.map((o) => {
    const picked = answers.filter((a) => a.option_id != null && String(a.option_id) === String(o.id));
    return { id: String(o.id), label: o.label, count: picked.length, percent: percent(picked.length), top: false, names: namesOf(picked) };
  });
  const best = Math.max(0, ...rows.map((r) => r.count));
  for (const r of rows) r.top = best > 0 && r.count === best;

  const groups = new Map();
  for (const a of answers) {
    if (a.other_text == null) continue;
    if (!groups.has(a.other_text)) groups.set(a.other_text, []);
    groups.get(a.other_text).push(a);
  }
  const others = [...groups.entries()]
    .map(([text, list]) => ({ text, count: list.length, names: namesOf(list) }))
    .sort((x, y) => y.count - x.count || byKo(x.text, y.text));

  return { voterCount, options: rows, others, otherCount: others.reduce((sum, g) => sum + g.count, 0) };
}

module.exports = { tally };
