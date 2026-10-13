(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const drawer = FilterDrawer.create({
    controls: $('job-controls'), toggle: $('mobile-filter-toggle'), backdrop: $('mobile-filter-backdrop'),
    closeBtn: $('filter-drawer-close'), applyBtn: $('filter-drawer-apply'), countSource: $('count-flat'),
    titleId: 'filter-drawer-title',
  });
  const view = JobsUI.createJobsView({
    showFirms: true,
    enableMatching: true,
    firmLabel: id => { const f = VC_FIRMS.find(x => x.id === id); return f ? f.short || f.name : id; },
    loadPage: JobsAPI.search,
    onData(data) {
      const s = data.metadata.summary || { total: data.total, companies: data.companies };
      $('all-stats').textContent = `${s.total.toLocaleString()} opportunities`;
      $('all-message').hidden = true;
    },
    onError() { $('all-stats').textContent = 'Listings temporarily unavailable'; },
  });
  window.JobView = view;
  view.onChange(() => drawer && drawer.syncCount());
  for (const id of ['job-controls', 'job-view-tabs', 'job-results-bar', 'job-list']) $(id).hidden = false;
  if (drawer) drawer.reveal();
  view.load();
})();
