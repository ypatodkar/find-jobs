function fixture() {
  return { scrapedAt: '2026-09-30T12:00:00.000Z', jobs: Array.from({ length: 110 }, (_, i) => ({
    job_id: `job_${i}`, title: `${i % 2 ? 'Frontend' : 'Backend'} Engineer ${String(i).padStart(3, '0')}`,
    company: ['Alpha', 'Beta', 'Gamma'][i % 3], city: i % 2 ? 'San Francisco' : 'Seattle',
    roles: [i % 2 ? 'frontend' : 'backend'], firms: [i % 2 ? 'sequoia' : 'accel'],
    markets: ['Developer Tools'], posted: '2026-09-28T12:00:00.000Z', seniority: 'senior',
    salaryMin: 150000, salaryMax: 200000 + i * 1000, salary: '$150k–$250k',
    size: '51-200', sponsorship: 'unknown', source: 'ats', ats: 'ashby',
    url: `https://example.com/jobs/${i}`, description: 'Build Python services with PostgreSQL and AWS. You will own distributed systems and mentor engineers. Five years of production software experience is required.',
  })) };
}
module.exports = { fixture };
