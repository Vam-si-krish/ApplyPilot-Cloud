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
    name: 'Vamsi Krishna Chiguruwada',
    label: 'Senior Frontend Engineer',
    email: 'vamsichiguruwada@gmail.com',
    phone: '(555) 123-4567',
    location: 'Boston, MA',
    url: 'github.com/vamsi',
    summary:
      'Senior Frontend Engineer with 6+ years building enterprise-scale web applications in React, Next.js, and TypeScript. Specialized in performance-critical UIs, design systems, and GraphQL data layers across finance and enterprise SaaS.',
  },
  work: [
    {
      name: 'JPMorgan Chase & Co.', position: 'Senior Frontend Developer', location: 'New York, NY', startDate: 'Jul 2025', endDate: 'Present',
      highlights: [
        'Architected a React + TypeScript analytics dashboard integrating GraphQL APIs, cutting data-fetch latency by 40%.',
        'Led the migration of a legacy Angular app to Next.js, improving Core Web Vitals and reducing bundle size by 35%.',
        'Built a reusable component library adopted by 5 teams, standardizing UI and accelerating delivery.',
      ],
    },
    {
      name: 'Yash Technologies', position: 'Frontend Developer', location: 'Hyderabad, India', startDate: 'Sep 2022', endDate: 'Aug 2024',
      highlights: [
        'Developed secure transaction interfaces with React and Redux supporting 10,000+ concurrent sessions.',
        'Optimized frontend assets with Webpack and SASS, reducing CSS bundle size by ~33%.',
      ],
    },
    {
      name: 'Msys Technologies', position: 'Frontend Developer', location: 'Chennai, India', startDate: 'Feb 2020', endDate: 'Aug 2022',
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
    { institution: 'Hult International Business School', studyType: 'Master of Science', area: 'Business Analytics', startDate: '2024', endDate: '2025' },
    { institution: 'JNTU', studyType: 'Bachelor of Technology', area: 'Computer Science', startDate: '2015', endDate: '2019' },
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
