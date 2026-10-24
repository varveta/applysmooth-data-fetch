// Entirely synthetic postings. Never used by a publishing workflow.
export const description =
  "Build reliable data pipelines using SQL and Python. Maintain batch processing, test data quality, document operational procedures, and work with engineers to resolve failures. ".repeat(
    3,
  );
export const greenhouseFixture = {
  id: 1,
  internal_job_id: 100,
  title: "Data Engineer",
  absolute_url: "https://boards.greenhouse.io/example/jobs/1",
  location: { name: "Chicago, IL, United States" },
  content: description,
  offices: [{ name: "Chicago", location: "Chicago, IL, United States" }],
  departments: [{ name: "Engineering" }],
  first_published: "2026-10-23T12:00:00Z",
  updated_at: "2026-10-23T12:00:00Z",
};
export const leverFixture = {
  id: "synthetic-1",
  text: "Data Engineer",
  hostedUrl: "https://jobs.lever.co/example/synthetic-1",
  applyUrl: "https://jobs.lever.co/example/synthetic-1/apply",
  categories: {
    location: "Chicago, IL, United States",
    commitment: "Full-time",
    team: "Engineering",
  },
  description: description,
  lists: [],
  createdAt: 1792756800000,
};
export const ashbyFixture = {
  id: "synthetic-1",
  title: "Data Engineer",
  department: "Engineering",
  employmentType: "FullTime",
  location: "Chicago, IL, United States",
  isRemote: false,
  descriptionPlain: description,
  jobUrl: "https://jobs.ashbyhq.com/example/synthetic-1",
  applyUrl: "https://jobs.ashbyhq.com/example/synthetic-1/application",
  isListed: true,
  publishedAt: "2026-10-23T12:00:00Z",
  address: {
    postalAddress: {
      addressCountry: "US",
      addressRegion: "Illinois",
      addressLocality: "Chicago",
    },
  },
};
