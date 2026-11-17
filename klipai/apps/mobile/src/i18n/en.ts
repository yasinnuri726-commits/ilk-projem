import type { Dict } from './tr';

export const en: Dict = {
  appName: 'KlipAI',
  common: { save: 'Save', cancel: 'Cancel', retry: 'Retry', delete: 'Delete', back: 'Back', next: 'Next', done: 'Done', loading: 'Loading…', error: 'Something went wrong', offline: 'You are offline; changes are kept on this device', seeAll: 'See all', close: 'Close', yes: 'Yes', no: 'No', edit: 'Edit', add: 'Add', confirm: 'Confirm', empty: 'Nothing here yet', min: 'min', sec: 'sec', copy: 'Copy' },
  auth: {
    tagline: 'Finds the strongest moments in long videos, turns them into shorts and uploads them to YouTube on a schedule.',
    start: 'Get started', haveAccount: 'I have an account', login: 'Log in', register: 'Sign up', email: 'Email', emailOrUser: 'Email or username', password: 'Password', name: 'Your name', forgot: 'Forgot password',
    google: 'Continue with Google', or: 'or', passwordHint: 'At least 8 characters', forgotTitle: 'Reset password', forgotInfo: 'We will email you a reset link.', forgotSent: 'If the account exists, a link was sent.',
    send: 'Send link', resetTitle: 'New password', resetDone: 'Password updated. You can log in now.', terms: 'By continuing you accept the Terms of Use and Privacy Policy.',
    invalid: 'Wrong email/username or password', taken: 'This email is already registered', logout: 'Log out',
  },
  channel: {
    connectTitle: 'Connect your YouTube channel', connectInfo: 'To upload clips to your channel, KlipAI needs upload and analytics permission. You can disconnect at any time.',
    connect: 'Connect with YouTube', connected: 'Channel connected', failed: 'Could not connect', disconnect: 'Disconnect', disconnectAsk: 'Scheduled uploads will be canceled. Are you sure?', all: 'All channels', status_TOKEN_EXPIRED: 'Needs reconnecting',
    pick: 'Pick channel', noChannel: 'Connect a channel first', team: 'Team', invite: 'Invite', inviteEmail: 'Email', roles: { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' }, pending: 'Invite pending',
  },
  tabs: { home: 'Home', calendar: 'Calendar', stats: 'Stats', templates: 'Templates', settings: 'Settings' },
  home: {
    today: 'Today', published: 'Published', scheduled: 'Scheduled', approval: 'Needs approval', failed: 'Failed', views24h: '24h views', queue: 'Queue', upcoming: 'Upcoming uploads',
    newProject: 'New project', noQueue: 'Nothing in the queue. Start a new project.', credits: 'Credits', clips: 'Clips', unlimited: 'Unlimited', rendering: 'Rendering', projects: 'Projects', recent: 'Recent projects',
  },
  stage: { INGEST: 'Ingest', ANALYZE: 'Analysis', CANDIDATES: 'Candidates', SCORE: 'Scoring', EDIT: 'Edit', COMMENTARY: 'Commentary', METADATA: 'Metadata', QC: 'Quality check', PUBLISH: 'Publish', LEARN: 'Learning' },
  project: {
    status_DRAFT: 'Draft', status_INGESTING: 'Ingesting', status_ANALYZING: 'Analyzing', status_GENERATING: 'Finding moments', status_SCORING: 'Scoring', status_READY: 'Ready', status_FAILED: 'Failed', status_CANCELED: 'Canceled', status_ARCHIVED: 'Archived',
    inBackground: 'You can close the app; you will get a notification when it finishes.', cancel: 'Cancel', cancelAsk: 'Processing stops and unused credit is refunded.', retry: 'Resume from failed stage', viewCandidates: 'View moments', candidates: 'moments', delete: 'Delete project', deleteAsk: 'The project, clips and files are permanently deleted.',
    stageStatus_QUEUED: 'Queued', stageStatus_RUNNING: 'Running', stageStatus_RETRYING: 'Retrying', stageStatus_SUCCEEDED: 'Done', stageStatus_FAILED: 'Failed', stageStatus_CANCELED: 'Canceled', attempt: 'Attempt',
  },
  wizard: {
    title: 'New project', step: 'Step', s1: 'Source', s2: 'Rights', s3: 'Settings', s4: 'Summary', projectName: 'Project name', pickFile: 'Pick a video or audio file', fileChosen: 'Selected file', orLink: 'or a direct file link',
    linkHint: 'https://…/video.mp4 (page links such as YouTube are not supported)', rightsTitle: 'Do you have the right to use this content?', basis_OWN_CONTENT: 'My own content', basis_LICENSED: 'Licensed', basis_PUBLIC_DOMAIN: 'Public domain', basis_PERMITTED: 'Rights holder permission',
    detailsHint: 'Licence number, grantor or source (optional)', accept: 'I confirm the declaration above is true', rightsNote: 'Your declaration is recorded with the date, IP and device details.',
    quick: 'For this project', minScore: 'Minimum score', maxClips: 'Max clips', channelSettingsHint: 'All other settings come from the channel profile.', summary: 'Summary', start: 'Start', uploading: 'Uploading', resume: 'Upload will resume where it left off',
    draftSaved: 'Draft kept on this device', needChannel: 'Pick a channel first', creating: 'Creating project…', uploadFailed: 'Upload failed. Try again; it resumes where it stopped.',
  },
  cand: {
    title: 'Moments', score: 'Score', hook: 'Hook', emotion: 'Emotion', standalone: 'Standalone', curiosity: 'Curiosity', shareability: 'Shareability', why: 'Why', risks: 'Heads-up', accept: 'Make clip', reject: 'Reject', open: 'Open clip',
    preview: 'Preview', minScore: 'Minimum score', none: 'No moments at this threshold', accepted: 'Accepted', suggestedHook: 'Suggested hook', limit: 'Your monthly clip allowance is used up',
  },
  clip: {
    title: 'Clip', status_CANDIDATE: 'Candidate', status_EDITING: 'Rendering', status_READY: 'Ready', status_SCHEDULED: 'Scheduled', status_PUBLISHED: 'Published', status_FAILED: 'Failed', status_ARCHIVED: 'Archived',
    qc: 'Quality check', qc_PENDING: 'Pending', qc_PASSED: 'Passed', qc_AUTO_FIXED: 'Auto-fixed', qc_FLAGGED: 'Needs your review', check_DURATION: 'Duration', check_RESOLUTION: 'Resolution', check_LOUDNESS: 'Loudness', check_SUBTITLE_OVERFLOW: 'Subtitle overflow', check_BLACK_FRAMES: 'Black frames',
    trim: 'Trim', start: 'Start', end: 'End', hookText: 'Hook text (first 2 s)', subtitles: 'Subtitle text', subtitlesHint: 'Fix wrong words; timing is kept.', commentary: 'Commentary script', commentaryHint: 'Each line: [second] text',
    titleLabel: 'Title', alternatives: 'Alternatives', description: 'Description', tags: 'Tags (comma separated)', hashtags: 'Hashtags (comma separated)', saveDraft: 'Save changes', rerender: 'Re-render', rerenderInfo: 'Re-render after changing trim, subtitles or commentary.',
    regen: 'Regenerate', regenCommentary: 'Commentary', regenMeta: 'Title & description', regenThumb: 'Thumbnail', schedule: 'Schedule', approve: 'Approve & schedule', publishNow: 'Publish now', cancelSchedule: 'Cancel schedule', download: 'Save to device', at: 'Publish time',
    pendingDraft: 'You have unsent changes', synced: 'Synced', conflict: 'The clip changed elsewhere. Your local changes are kept.', keepMine: 'Apply mine', useServer: 'Use server version', watermark: 'A watermark is added on the free plan',
    privacy: 'Privacy', privacy_PUBLIC: 'Public', privacy_UNLISTED: 'Unlisted', privacy_PRIVATE: 'Private', renderingNow: 'Rendering', saved: 'Saved',
  },
  cal: { title: 'Calendar', empty: 'No uploads on this day', reschedule: 'Change time', cancel: 'Cancel schedule', retry: 'Retry', approve: 'Approve', open: 'Open clip', quota: 'YouTube quota', uploadsLeft: 'uploads left', bestTimes: 'Best times', today: 'Today',
    status_PENDING_APPROVAL: 'Needs approval', status_SCHEDULED: 'Scheduled', status_QUOTA_DEFERRED: 'Deferred (quota)', status_UPLOADING: 'Uploading', status_RETRY_WAIT: 'Will retry', status_PROCESSING: 'YouTube processing', status_PUBLISHED: 'Published', status_FAILED: 'Failed', status_CANCELED: 'Canceled' },
  stats: { title: 'Stats', views: 'Views', likes: 'Likes', comments: 'Comments', subs: 'New subscribers', clips: 'Clips published', retention: 'Avg. view %', top: 'Top clips', insight: 'What we learned', insightHint: 'Future scoring uses these findings.', none: 'No published clips yet', range7: '7 days', range28: '28 days', range90: '90 days' },
  tpl: { title: 'Templates', SUBTITLE: 'Subtitle', BRAND: 'Brand', COMMENTARY: 'Commentary', METADATA: 'Metadata', system: 'System', mine: 'Mine', apply: 'Apply to channel', applied: 'Applied', saveCurrent: 'Save from current settings', name: 'Template name', deleteAsk: 'Delete this template?' },
  set: {
    title: 'Settings', account: 'Account', language: 'Language', theme: 'Theme', lang_system: 'System', lang_tr: 'Türkçe', lang_en: 'English', theme_system: 'System', theme_light: 'Light', theme_dark: 'Dark', channels: 'Channels', profile: 'Channel profile', subscription: 'Subscription', notifications: 'Notifications',
    privacy: 'Privacy & data', export: 'Export my data', exportDone: 'You will get a link by email when it is ready.', deleteAccount: 'Delete my account', deleteAsk: 'Your account is disabled immediately and permanently deleted after 30 days. Rights declarations are kept anonymised as a legal requirement.', version: 'Version', policy: 'Privacy Policy', terms: 'Terms of Use',
  },
  prof: {
    title: 'Channel profile', automation: 'Automation', mode_FULL_AUTO: 'Full auto', mode_APPROVAL: 'Approval', mode_DRAFT_ONLY: 'Drafts only', modeHint_FULL_AUTO: 'Clips above the threshold are edited and scheduled automatically.', modeHint_APPROVAL: 'Clips are edited and wait for your approval to publish.', modeHint_DRAFT_ONLY: 'You pick the moments and set the schedule.',
    plan: 'Publishing plan', daily: 'Clips per day', slots: 'Time windows', addSlot: 'Add window', timezone: 'Time zone', bestTimes: 'Use best-time suggestions', cut: 'Moments', minDur: 'Shortest (s)', maxDur: 'Longest (s)', minScore: 'Minimum score', maxClips: 'Max clips per video',
    format: 'Format', ratio_PORTRAIT_9_16: 'Shorts 9:16', ratio_SQUARE_1_1: 'Square 1:1', ratio_LANDSCAPE_16_9: 'Landscape 16:9', res_HD_720: '720p', res_FHD_1080: '1080p', res_UHD_4K: '4K',
    subtitle: 'Subtitles', subOn: 'Add subtitles', font: 'Font', size: 'Size', color: 'Colour', highlight: 'Highlight colour', position: 'Position', pos_TOP: 'Top', pos_MIDDLE: 'Middle', pos_BOTTOM: 'Bottom', subLang: 'Subtitle language', translate: 'Translate to (empty = none)',
    commentary: 'Commentary', format_NONE: 'None', format_REACTION: 'Reaction', format_ANALYSIS: 'Analysis', format_RANKING: 'Ranking', tone: 'Tone', tone_FUNNY: 'Funny', tone_SERIOUS: 'Serious', tone_INFORMATIVE: 'Informative', customPrompt: 'Custom instructions', maxSec: 'Commentary length (s)',
    audio: 'Audio', voice: 'TTS voice', speed: 'Speed', music: 'Music genre', musicLevel: 'Music level (dB)', brand: 'Brand', brandInfo: 'Logo, watermark and intro/outro files are uploaded from the web dashboard; you see their keys here.', palette: 'Colour palette (#RRGGBB, comma separated)',
    meta: 'Metadata', titleLang: 'Title language', fixedTags: 'Fixed tags (comma separated)', descTemplate: 'Description template', descHint: '{description} {hashtags} {title}', category: 'Category', privacy: 'Default privacy', kids: 'Made for kids', saved: 'Settings saved', planLimit: 'Upgrade your plan for this option',
  },
  sub: {
    title: 'Subscription', current: 'Current plan', free: 'Free', pro: 'Pro', agency: 'Agency', developer: 'Developer account: all limits off', month: 'mo', clipsPerMonth: 'clips / month', unlimitedClips: 'Unlimited queue', res: 'resolution', channels: 'channels', team: 'Team access', watermark: 'Watermarked', noWatermark: 'No watermark',
    usage: 'Usage this period', creditsUsed: 'Minutes processed', clipsUsed: 'Clips', renews: 'Renews', ends: 'Ends', choose: 'Choose plan', restore: 'Restore purchases', history: 'Credit history', storeError: 'The store is unavailable right now', purchased: 'Plan updated', creditNote: 'Credit = minutes of source video processed.',
    kind_CREDIT_GRANT: 'Period credit', kind_CREDIT_CONSUME: 'Processing', kind_CREDIT_REFUND: 'Refund', kind_CLIP_RENDER: 'Clip',
  },
  notif: { title: 'Notifications', markAll: 'Mark all read', none: 'No notifications',
    PROJECT_READY: '{count} moments ready for “{title}”', PROJECT_FAILED: '“{title}” could not be processed', CLIP_READY: '“{title}” is ready to publish', CLIP_NEEDS_APPROVAL: '“{title}” needs your approval', CLIP_PUBLISHED: '“{title}” is live', PUBLISH_FAILED: '“{title}” could not be uploaded',
    QUOTA_WARNING: 'YouTube quota reached; uploads were deferred', CHANNEL_TOKEN_EXPIRED: 'Reconnect the channel “{title}”', CREDITS_LOW: '{remaining} min of credit left', SUBSCRIPTION_CHANGED: 'Plan: {plan}', TEAM_INVITE: 'You were invited to “{title}”' },
  err: {
    NETWORK: 'Could not reach the server. Check your connection.', CREDITS_EXHAUSTED: 'You are out of processing credit for this period. You can upgrade your plan.', CLIP_LIMIT_REACHED: 'Your monthly clip allowance is used up.', CHANNEL_LIMIT_REACHED: 'Your plan does not allow this many channels.', PLAN_REQUIRED: 'Upgrade your plan to use this feature.',
    VERSION_CONFLICT: 'The record changed elsewhere. Refresh and try again.', FORBIDDEN: 'You do not have permission to do this.', NOT_FOUND: 'Not found.', INVALID_STATE: 'This cannot be done right now.', RATE_LIMITED: 'Too many requests. Wait a moment.', UPLOAD_TOO_LARGE: 'The file is too large.', UNSUPPORTED_MEDIA: 'Unsupported file type.',
    CHANNEL_TOKEN_EXPIRED: 'The YouTube connection is invalid. Reconnect the channel.', VALIDATION_FAILED: 'Some of the information is invalid.', INTERNAL: 'An unexpected error occurred.', NO_SPEECH: 'Not enough speech in the video.', NO_CANDIDATES: 'No suitable moments found.', UNSUPPORTED_MEDIA_: '',
  },
};
