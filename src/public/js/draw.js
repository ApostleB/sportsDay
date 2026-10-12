// 팀 뽑기 연출. 결과는 서버 응답에서만 받고, 응답을 해석할 수 없으면 일반 폼 전송으로 넘긴다
(() => {
  const form = document.getElementById('drawForm');
  if (!form) return;
  const teams = JSON.parse(document.getElementById('drawTeams').textContent);
  const drum = document.getElementById('drum');
  const slot = document.getElementById('slot');
  const hint = document.getElementById('slotHint');
  const out = document.getElementById('drawResult');
  const controls = document.getElementById('drawControls');
  const homeLink = controls.querySelector('.btn-ghost');
  const template = document.getElementById('bibTemplate');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timers = [];

  function buildBib(data) {
    const bib = template.content.firstElementChild.cloneNode(true);
    bib.classList.add(`team-${data.team.color}`, 'reveal');
    const badge = bib.querySelector('.badge');
    badge.className = `badge team-${data.team.color}`;
    badge.textContent = `${data.team.mark} ${data.team.name}팀`;
    if (data.leaderName) {
      const leader = document.createElement('span');
      leader.className = 'badge';
      leader.textContent = `팀장: ${data.leaderName}`;
      bib.appendChild(leader);
    }
    return bib;
  }

  function show(data) {
    timers.forEach(clearTimeout);
    timers = [];
    slot.textContent = `${data.team.mark} ${data.team.name}`;
    hint.textContent = '결과 발표';
    out.replaceChildren(buildBib(data));
    const board = document.createElement('a');
    board.className = 'btn btn-block';
    board.href = form.dataset.teamsUrl;
    board.textContent = '팀 현황 보기';
    controls.replaceChildren(board, homeLink);
  }

  // 0–600ms 흔들림, 600–2400ms 팀 이름이 감속하며 지나감, 2400–2800ms 결과 등장
  function play(data) {
    if (reduce) return show(data);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn-ghost btn-block';
    skip.textContent = '결과 바로 보기';
    skip.addEventListener('click', () => show(data));
    controls.replaceChildren(skip);
    hint.textContent = '섞는 중';
    drum.classList.remove('shake');
    void drum.offsetWidth;
    drum.classList.add('shake');
    let t = 600;
    let delay = 60;
    let i = 0;
    while (t < 2400) {
      const team = teams[i % teams.length];
      timers.push(setTimeout(() => { slot.textContent = `${team.mark} ${team.name}`; }, t));
      t += delay;
      delay = Math.round(delay * 1.18);
      i += 1;
    }
    timers.push(setTimeout(() => { slot.textContent = `${data.team.mark} ${data.team.name}`; }, 2400));
    timers.push(setTimeout(() => show(data), 2800));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    hint.textContent = '팀 확인 중';
    let res;
    let data;
    try {
      res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      data = await res.json();
    } catch {
      form.submit();
      return;
    }
    if (!res.ok || !data.team) {
      hint.textContent = data.error || '뽑기에 실패했어요. 다시 눌러 주세요';
      button.disabled = false;
      return;
    }
    play(data);
  });
})();
