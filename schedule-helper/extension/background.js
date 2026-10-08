// Clicking the toolbar button opens the review screen.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }));
