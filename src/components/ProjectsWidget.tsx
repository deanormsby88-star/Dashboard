'use client'
import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import clsx from 'clsx'

export interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'in_progress' | 'paused' | 'completed'
  claudeUrl: string
  lastUpdated: string
  notes?: string
  tags?: string[]
}

const STATUS = {
  active: { label: 'Active', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  in_progress: { label: 'In Progress', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  paused: { label: 'Paused', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  completed: { label: 'Completed', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
}

export default function ProjectsWidget() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)
  const [showForm, setShowForm] = useState(false)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/projects')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setProjects(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  const saveProjects = async (updated: Project[]) => {
    const res = await fetch('/api/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    if (!res.ok) throw new Error('Failed to save')
    setProjects(updated)
  }

  const handleSave = async (project: Project) => {
    const updated = editing
      ? projects.map((p) => (p.id === editing.id ? project : p))
      : [...projects, { ...project, id: Date.now().toString() }]
    await saveProjects(updated)
    setEditing(null)
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    await saveProjects(projects.filter((p) => p.id !== id))
  }

  return (
    <div className="card flex flex-col h-full">
      <div className="card-header">
        <h2 className="card-title">
          <span className="mr-2">🤖</span>Claude Projects
        </h2>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          + Add
        </button>
      </div>

      <div className="card-body">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <span className="text-2xl mb-2">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : loading ? (
          <SkeletonList count={3} />
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <span className="text-3xl mb-2">🚀</span>
            <p className="text-sm text-slate-400 mb-3">No projects yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Add your first project
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {projects.map((project) => (
              <li key={project.id} className="project-item group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={project.claudeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-100 hover:text-blue-400 transition-colors"
                      >
                        {project.name}
                      </a>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', STATUS[project.status]?.color)}>
                        {STATUS[project.status]?.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{project.description}</p>
                    {project.notes && (
                      <p className="text-xs text-slate-500 mt-1 italic">💬 {project.notes}</p>
                    )}
                    {project.tags && project.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {project.tags.map((tag) => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-slate-600 mt-1">
                      Updated {format(parseISO(project.lastUpdated), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => { setEditing(project); setShowForm(true) }}
                      className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="p-1 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <ProjectForm
          project={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

interface FormProps {
  project: Project | null
  onSave: (p: Project) => void
  onCancel: () => void
}

function ProjectForm({ project, onSave, onCancel }: FormProps) {
  const [form, setForm] = useState<Omit<Project, 'id'>>({
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    claudeUrl: project?.claudeUrl ?? '',
    lastUpdated: project?.lastUpdated ?? new Date().toISOString().split('T')[0],
    notes: project?.notes ?? '',
    tags: project?.tags ?? [],
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({ ...form, id: project?.id ?? '' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="p-4 border-b border-slate-800">
          <h3 className="font-semibold text-slate-100">
            {project ? 'Edit Project' : 'Add Claude Project'}
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="form-label">Project Name *</label>
            <input
              required
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Customer Portal Redesign"
            />
          </div>
          <div>
            <label className="form-label">Description</label>
            <input
              className="form-input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description of the project"
            />
          </div>
          <div>
            <label className="form-label">Claude.ai Project URL *</label>
            <input
              required
              className="form-input"
              value={form.claudeUrl}
              onChange={(e) => setForm({ ...form, claudeUrl: e.target.value })}
              placeholder="https://claude.ai/project/..."
            />
          </div>
          <div>
            <label className="form-label">Status</label>
            <select
              className="form-input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Project['status'] })}
            >
              <option value="active">Active</option>
              <option value="in_progress">In Progress</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label className="form-label">Latest Notes</label>
            <input
              className="form-input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="What's happening with this project?"
            />
          </div>
          <div>
            <label className="form-label">Tags (comma-separated)</label>
            <input
              className="form-input"
              value={(form.tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="e.g. frontend, api, urgent"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="p-3 rounded-lg border border-slate-800 animate-pulse space-y-2">
          <div className="flex gap-2">
            <div className="h-3 bg-slate-700 rounded w-1/2" />
            <div className="h-3 bg-slate-800 rounded w-16 ml-2" />
          </div>
          <div className="h-3 bg-slate-800 rounded w-3/4" />
        </li>
      ))}
    </ul>
  )
}
