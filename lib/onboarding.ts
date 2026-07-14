import type { ResumeDoc } from './types';
import { resumeToText } from './resume';

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

function profileUrl(doc: ResumeDoc, network: string): string {
  return doc.basics.profiles?.find((profile) => profile.network?.toLowerCase().includes(network))?.url || '';
}

function experienceYears(doc: ResumeDoc): number | null {
  const years = doc.work
    .flatMap((work) => [work.startDate, work.endDate])
    .map((value) => value?.match(/(?:19|20)\d{2}/)?.[0])
    .filter((value): value is string => !!value)
    .map(Number);
  if (!years.length) return null;
  const first = Math.min(...years);
  const hasCurrent = doc.work.some((work) => !work.endDate || /present|current/i.test(work.endDate));
  const last = hasCurrent ? new Date().getFullYear() : Math.max(...years);
  return Math.max(0, last - first);
}

export function deriveOnboarding(doc: ResumeDoc) {
  const allSkills = unique(doc.skills.flatMap((group) => [group.name, ...group.keywords]));
  const languages: string[] = [];
  const frameworks: string[] = [];
  const tools: string[] = [];
  for (const group of doc.skills) {
    const name = (group.name || '').toLowerCase();
    const values = unique(group.keywords.length ? group.keywords : [group.name]);
    if (/language|programming/.test(name)) languages.push(...values);
    else if (/framework|frontend|backend|library/.test(name)) frameworks.push(...values);
    else tools.push(...values);
  }

  const roles = unique([doc.basics.label, ...doc.work.slice(0, 3).map((work) => work.position)]);
  const locations = unique([doc.basics.location]);
  const years = experienceYears(doc);
  const education = doc.education[0];

  return {
    resumeText: resumeToText(doc),
    personal: {
      full_name: doc.basics.name || '',
      email: doc.basics.email || '',
      phone: doc.basics.phone || '',
      city: doc.basics.location || '',
      linkedin_url: profileUrl(doc, 'linkedin'),
      github_url: profileUrl(doc, 'github'),
    },
    experience: {
      years_of_experience_total: years == null ? '' : String(years),
      target_role: roles[0] || '',
      education_level: [education?.studyType, education?.area].filter(Boolean).join(' — '),
    },
    skillsBoundary: {
      programming_languages: unique(languages),
      frameworks: unique(frameworks),
      tools: unique(tools),
    },
    assistantProfile: {
      resume_facts: doc,
      professional_summary: doc.basics.summary || '',
      work_history: doc.work,
      education: doc.education,
      projects: doc.projects,
      skills: allSkills,
    },
    settings: {
      skills: allSkills,
      keyword_options: roles,
      keywords: roles.slice(0, 2),
      location_options: locations,
      locations,
    },
  };
}
