// 기타 내용을 적으면 기타 선택지를 함께 체크한다. 라디오면 이전 선택은 자동으로 풀린다
(() => {
  const text = document.querySelector('input[name=other]');
  const choice = document.querySelector('input[name=option][value=other]');
  if (!text || !choice) return;
  text.addEventListener('input', () => {
    if (text.value.trim()) choice.checked = true;
  });
})();
