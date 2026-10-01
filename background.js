chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ghx-open-options') chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
