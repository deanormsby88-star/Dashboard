import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PROJECTS_PATH = join(process.cwd(), 'projects.json')

function readProjects() {
  try {
    return JSON.parse(readFileSync(PROJECTS_PATH, 'utf8'))
  } catch {
    return []
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(readProjects())
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const projects = await req.json()
  writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2))
  return NextResponse.json({ ok: true })
}
