/**
 * Local render check (no Supabase). Renders a résumé JSON to PDFs in both templates
 * so you can eyeball quality + one-page fit.
 *
 *   node render-sample.js                 # built-in sample
 *   node render-sample.js path/to.json    # your own ResumeDoc JSON
 */
import fs from 'node:fs';
import { renderResumePdf, closeBrowser } from './render.js';

const SAMPLE = {
  basics: {
    name: 'Jordan Lee',
    label: 'Senior Frontend Engineer',
    email: 'jordan.lee@example.com',
    phone: '(555) 123-4567',
    location: 'Denver, CO',
    url: 'github.com/jordanlee',
    summary:
      'Senior Frontend Engineer with 6+ years building enterprise-scale web applications in React, Next.js, and TypeScript. Specialized in performance-critical UIs, design systems, and GraphQL data layers across finance and enterprise SaaS.',
  },
  work: [
    {
      name: 'Northwind Labs', position: 'Senior Frontend Developer', location: 'Denver, CO', startDate: 'Jul 2022', endDate: 'Present',
      highlights: [
        'Architected a React + TypeScript analytics dashboard integrating GraphQL APIs, cutting data-fetch latency by 40%.',
        'Led the migration of a legacy Angular app to Next.js, improving Core Web Vitals and reducing bundle size by 35%.',
        'Built a reusable component library adopted by 5 teams, standardizing UI and accelerating delivery.',
      ],
    },
    {
      name: 'Example Systems', position: 'Frontend Developer', location: 'Austin, TX', startDate: 'Sep 2020', endDate: 'Jun 2022',
      highlights: [
        'Developed secure transaction interfaces with React and Redux supporting 10,000+ concurrent sessions.',
        'Optimized frontend assets with Webpack and SASS, reducing CSS bundle size by ~33%.',
      ],
    },
    {
      name: 'Contoso Software', position: 'Frontend Developer', location: 'Chicago, IL', startDate: 'Feb 2018', endDate: 'Aug 2020',
      highlights: [
        'Built scalable, reusable React component libraries ensuring consistent UI/UX across 15+ screens.',
        'Resolved cross-browser rendering issues using Chrome DevTools and responsive design techniques.',
      ],
    },
  ],
  skills: [
    { name: 'Core', keywords: ['JavaScript (ES6+)', 'TypeScript', 'HTML5', 'CSS3'] },
    { name: 'Frameworks', keywords: ['React.js', 'Next.js', 'Redux', 'Node.js', 'Express.js'] },
    { name: 'Styling', keywords: ['Tailwind CSS', 'SASS', 'Responsive design'] },
    { name: 'Tooling', keywords: ['Webpack', 'Vite', 'Git', 'Docker', 'Jenkins'] },
    { name: 'APIs & Testing', keywords: ['GraphQL', 'REST', 'Jest', 'React Testing Library'] },
  ],
  education: [
    { institution: 'Example State University', studyType: 'Master of Science', area: 'Information Systems', startDate: '2016', endDate: '2018' },
    { institution: 'Sample College', studyType: 'Bachelor of Science', area: 'Computer Science', startDate: '2012', endDate: '2016' },
  ],
  projects: [],
};

const arg = process.argv[2];
const resume = arg ? JSON.parse(fs.readFileSync(arg, 'utf8')) : SAMPLE;

for (const template of ['classic', 'modern']) {
  const { pdf, scale, pages, tooLong } = await renderResumePdf(resume, template);
  const out = `sample-${template}.pdf`;
  fs.writeFileSync(out, pdf);
  console.log(`${out}: ${pdf.length} bytes · scale ${scale} · ${pages} page(s)${tooLong ? ' · TOO LONG' : ''}`);
}
await closeBrowser();
