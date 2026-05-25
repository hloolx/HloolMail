import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Eye, Megaphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminAnnouncement } from '../api';
import { api, postJSON } from '../api';
import { relativeTime } from '../lib/display';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { useText } from '../locales';
import { DataTable, InfoTip } from '../components/shared';
import { simpleMarkdownToHTML } from '../lib/markdown';

export function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const text = useText();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);

  const announcements = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: () => api<AdminAnnouncement[]>('/api/admin/announcements'),
    retry: false
  });

  const createAnnouncement = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error('Title is required');
      return postJSON<AdminAnnouncement>('/api/admin/announcements', {
        title: title.trim(),
        content: content.trim()
      });
    },
    onSuccess: () => {
      setTitle('');
      setContent('');
      setPreview(false);
      queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
      notifySuccess(text.announcements.created, { origin: createButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteAnnouncement = useMutation({
    mutationFn: (id: number) => api(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      queryClient.setQueryData<AdminAnnouncement[]>(['admin-announcements'], (old) =>
        (old || []).filter((a) => a.id !== id)
      );
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      queryClient.invalidateQueries({ queryKey: ['announcements-unread-count'] });
      notifySuccess(text.announcements.deleted, { burst: false });
    },
    onError: (error) => toast.error(error.message)
  });

  const handleDelete = async (ann: AdminAnnouncement) => {
    if (!window.confirm(text.announcements.deleteConfirm)) return;

    const row = document.querySelector(`[data-announcement-id="${ann.id}"]`)?.closest('tr') as HTMLElement | null;
    if (row) {
      await runDeleteEffect(row);
    }
    deleteAnnouncement.mutate(ann.id);
  };

  const rows = (announcements.data || []).map((ann) => ({
    key: ann.id,
    cells: [
      <div className="admin-domain-cell">
        <b>{ann.title}</b>
        <small>{ann.content.slice(0, 80)}{ann.content.length > 80 ? '...' : ''}</small>
      </div>,
      relativeTime(ann.created_at),
      text.announcements.readerCount.replace('{count}', String(ann.reader_count ?? 0)),
      <div className="table-actions" data-announcement-id={ann.id}>
        <button
          className="btn-ghost"
          onClick={() => handleDelete(ann)}
          disabled={deleteAnnouncement.isPending}
          aria-label={text.announcements.deleteAnnouncement}
        >
          <Trash2 size={14} aria-hidden="true" />
          {text.announcements.deleteAnnouncement}
        </button>
      </div>
    ]
  }));

  return (
    <div className="admin-page grid gap-4">
      <div className="admin-page-header">
        <div>
          <h1>{text.announcements.pageTitle}<InfoTip text={text.announcements.pageDesc} /></h1>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.announcements.newAnnouncement}<InfoTip text={text.announcements.createHint} /></h2>
          </div>
        </div>

        <div className="admin-announcement-form">
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.common.create} {text.announcements.title}</span>
            <input
              className="input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={text.announcements.titlePlaceholder}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--muted)]">{text.announcements.content}</span>
            <textarea
              className="input-textarea"
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={text.announcements.contentPlaceholder}
            />
          </label>
          <div className="admin-announcement-actions">
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setPreview((v) => !v)}
              disabled={!content.trim()}
              aria-label={text.announcements.preview}
            >
              <Eye size={14} aria-hidden="true" />
              {text.announcements.preview}
            </button>
            <button
              ref={createButtonRef}
              className="btn-secondary"
              type="button"
              onClick={() => createAnnouncement.mutate()}
              disabled={!title.trim() || createAnnouncement.isPending}
              aria-label={text.announcements.createAnnouncement}
            >
              <Megaphone size={14} aria-hidden="true" />
              {createAnnouncement.isPending ? text.common.loading : text.announcements.createAnnouncement}
            </button>
          </div>
          {preview && content.trim() && (
            <div className="admin-announcement-preview">
              <div
                className="message-center-markdown"
                dangerouslySetInnerHTML={{ __html: simpleMarkdownToHTML(content) }}
              />
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header admin-panel-header">
          <div>
            <h2>{text.announcements.listTitle}</h2>
            <p>{text.announcements.listDesc}</p>
          </div>
        </div>

        <DataTable
          ariaLabel={text.announcements.listTitle}
          emptyLabel={text.announcements.noAnnouncements}
          columns={[
            { key: 'title', header: text.announcements.title, minWidth: '18rem' },
            { key: 'created', header: text.common.refresh, width: '8rem' },
            { key: 'readers', header: text.announcements.read, align: 'right', width: '8rem' },
            { key: 'actions', role: 'actions', header: text.common.delete, align: 'right', width: '10rem' }
          ]}
          rows={rows}
        />
      </section>
    </div>
  );
}
