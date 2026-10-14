(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const firmId = new URLSearchParams(location.search).get('id');
  const firm = VC_FIRMS.find(f => f.id === firmId);
  if (!firm) {
    $('firm-name').textContent = 'Firm not found';
    $('firm-message').textContent = 'Choose an investor from the directory to see its portfolio roles.';
    $('firm-message').hidden = false;
    return;
  }
  document.title = firm.name + ' jobs — Find Jobs';
  $('firm-name').textContent = firm.name;
  $('firm-tier').textContent = TIER_META[firm.tier].label;
  $('firm-focus').textContent = firm.focus;
  const drawer = FilterDrawer.create({
    controls: $('job-controls'), toggle: $('mobile-filter-toggle'), backdrop: $('mobile-filter-backdrop'),
    closeBtn: $('filter-drawer-close'), applyBtn: $('filter-drawer-apply'), countSource: $('count-flat'),
    titleId: 'filter-drawer-title',
  });
  const view = JobsUI.createJobsView({
    showFirms: false, contextLabel: firm.short || firm.name, scopeFirm: firmId,
    loadPage: JobsAPI.search,
    onData(data) {
      const info = data.metadata.firms?.[firmId];
      $('firm-stats').textContent = `${data.total.toLocaleString()} matching roles · ${data.companies.toLocaleString()} companies`;
      $('footer-note').textContent = `Portfolio companies discovered via ${info?.host || firm.name}. Full descriptions are loaded when you open them.`;
      $('firm-message').hidden = !info || info.status === 'ok';
      if (info && info.status !== 'ok') $('firm-message').textContent = info.status === 'unsupported'
        ? (info.reason || 'This investor’s portfolio board cannot be checked automatically.')
        : 'The latest check of this investor’s board failed. Previously saved listings may still be shown.';
    },
    onError() { $('firm-stats').textContent = 'Listings temporarily unavailable'; },
  });
  window.JobView = view;
  view.onChange(() => drawer && drawer.syncCount());
  for (const id of ['job-controls', 'job-results-bar', 'job-list']) $(id).hidden = false;
  if (drawer) drawer.reveal();
  view.load();
})();
