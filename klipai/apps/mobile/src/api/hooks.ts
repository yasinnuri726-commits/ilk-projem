import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  AppNotification, Candidate, Channel, ChannelSettings, Clip, Dashboard, Member, Project, ProjectDetail, PublishJob, StatsOverview, SubscriptionInfo, Template, UsageEntry, User,
} from './types';

interface Page<T> { items: T[]; nextCursor: string | null }

export const qk = {
  me: ['me'] as const,
  channels: ['channels'] as const,
  settings: (id: string) => ['settings', id] as const,
  members: (id: string) => ['members', id] as const,
  dashboard: (ch?: string) => ['dashboard', ch ?? 'all'] as const,
  projects: (ch?: string) => ['projects', ch ?? 'all'] as const,
  project: (id: string) => ['project', id] as const,
  candidates: (id: string) => ['candidates', id] as const,
  clips: (p: Record<string, string | undefined>) => ['clips', p] as const,
  clip: (id: string) => ['clip', id] as const,
  publish: (ch: string | undefined, from: string) => ['publish', ch ?? 'all', from] as const,
  stats: (ch: string, range: string) => ['stats', ch, range] as const,
  sub: ['subscription'] as const,
  usage: ['usage'] as const,
  notifications: ['notifications'] as const,
  templates: (kind?: string) => ['templates', kind ?? 'all'] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<User>('/me') });
export const useChannels = () => useQuery({ queryKey: qk.channels, queryFn: () => api<{ items: Channel[] }>('/channels').then((r) => r.items) });
export const useSettings = (id?: string) => useQuery({ queryKey: qk.settings(id ?? ''), enabled: !!id, queryFn: () => api<ChannelSettings>(`/channels/${id}/settings`) });
export const useMembers = (id: string) => useQuery({ queryKey: qk.members(id), queryFn: () => api<{ items: Member[] }>(`/channels/${id}/members`).then((r) => r.items) });
export const useDashboard = (ch?: string) => useQuery({ queryKey: qk.dashboard(ch), queryFn: () => api<Dashboard>('/dashboard', { query: { channelId: ch } }), refetchInterval: 60_000 });
export const useProject = (id: string) => useQuery({ queryKey: qk.project(id), queryFn: () => api<ProjectDetail>(`/projects/${id}`) });
export const useCandidates = (id: string) => useQuery({ queryKey: qk.candidates(id), queryFn: () => api<{ items: Candidate[] }>(`/projects/${id}/candidates`).then((r) => r.items) });
export const useClip = (id: string) => useQuery({ queryKey: qk.clip(id), queryFn: () => api<Clip>(`/clips/${id}`) });
export const useSubscription = () => useQuery({ queryKey: qk.sub, queryFn: () => api<SubscriptionInfo>('/subscription') });
export const useTemplates = (kind?: string, channelId?: string) => useQuery({ queryKey: qk.templates(kind), queryFn: () => api<{ items: Template[] }>('/templates', { query: { kind, channelId } }).then((r) => r.items) });
export const useStats = (ch: string | undefined, range: '7d' | '28d' | '90d') =>
  useQuery({ queryKey: qk.stats(ch ?? '', range), enabled: !!ch, queryFn: () => api<StatsOverview>('/stats/overview', { query: { channelId: ch, range } }), placeholderData: keepPreviousData });

export const useProjects = (ch?: string) =>
  useInfiniteQuery({
    queryKey: qk.projects(ch), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<Project>>('/projects', { query: { channelId: ch, cursor: pageParam, limit: 20 } }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useUsage = () =>
  useInfiniteQuery({
    queryKey: qk.usage, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<UsageEntry>>('/usage', { query: { cursor: pageParam, limit: 30 } }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: qk.notifications, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<AppNotification> & { unreadCount: number }>('/notifications', { query: { cursor: pageParam, limit: 30 } }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
export const useUnreadCount = () => useQuery({ queryKey: ['unread'], queryFn: () => api<{ unreadCount: number }>('/notifications', { query: { limit: 1, unread: true } }).then((r) => r.unreadCount), refetchInterval: 120_000 });

export const usePublishJobs = (ch: string | undefined, from: Date, to: Date) =>
  useQuery({
    queryKey: qk.publish(ch, from.toISOString()),
    queryFn: () => api<{ items: PublishJob[] }>('/publish-jobs', { query: { channelId: ch, from: from.toISOString(), to: to.toISOString() } }).then((r) => r.items),
  });

/** Mutasyon sonrası ilgili sorguları tazeler. */
export function useAction<TIn, TOut>(fn: (v: TIn) => Promise<TOut>, invalidate: (readonly unknown[])[] = []) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] }))) });
}
