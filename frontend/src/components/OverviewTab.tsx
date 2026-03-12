import { marked } from 'marked';
import type { Project } from '../lib/types';

interface Props {
  project: Project | null;
}

export default function OverviewTab({ project }: Props) {
  if (!project) {
    return <div className="text-gray-400 text-center py-16">Loading...</div>;
  }

  return (
    <div className="fade-in space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Documents" value={project.counts.documents} />
        <StatCard label="Threads" value={project.counts.threads} />
        <StatCard label="Memory Items" value={project.counts.memory_items} />
      </div>

      {/* Role Statement */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="font-semibold text-gray-900 mb-2">Role Statement</h3>
        <p className="text-gray-600 text-sm whitespace-pre-wrap">
          {project.role_statement || '-'}
        </p>
      </div>

      {/* Brief */}
      {project.brief && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Project Brief</h3>
          <div
            className="prose prose-sm max-w-none text-gray-600"
            dangerouslySetInnerHTML={{
              __html: marked.parse(project.brief.brief_markdown) as string,
            }}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-3xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}
