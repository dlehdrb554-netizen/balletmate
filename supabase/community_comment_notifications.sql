-- Community comment push notifications (post authors + bookmarkers).
-- Safe to re-run. Run after push_notifications_and_app_notices.sql and community_bookmarks.sql.

create or replace function public.notify_community_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.community_posts%rowtype;
  v_bookmark_users uuid[];
begin
  select * into v_post
  from public.community_posts
  where id = new.post_id;

  if not found then
    return new;
  end if;

  -- Notify the author of the post, but never notify the commenter about their own comment.
  if v_post.author_id <> new.author_id then
    perform public.dispatch_balletmate_push(jsonb_build_object(
      'scope','users',
      'user_ids',jsonb_build_array(v_post.author_id),
      'preference','postComments',
      'title','내 게시글에 새 댓글',
      'body',left(new.author_name || ': ' || new.content,180),
      'data',jsonb_build_object('postId',new.post_id,'commentId',new.id,'kind','post_comment')
    ));
  end if;

  -- Notify members who bookmarked this post, excluding the commenter.
  select coalesce(array_agg(distinct b.user_id),array[]::uuid[])
  into v_bookmark_users
  from public.community_post_bookmarks b
  where b.post_id=new.post_id
    and b.user_id<>new.author_id;

  if cardinality(v_bookmark_users)>0 then
    perform public.dispatch_balletmate_push(jsonb_build_object(
      'scope','users',
      'user_ids',to_jsonb(v_bookmark_users),
      'preference','bookmarkComments',
      'title','북마크한 게시글에 새 댓글',
      'body',left(new.author_name || ': ' || new.content,180),
      'data',jsonb_build_object('postId',new.post_id,'commentId',new.id,'kind','bookmark_comment')
    ));
  end if;

  return new;
end;
$$;

revoke all on function public.notify_community_comment() from public,anon,authenticated;
drop trigger if exists push_community_comment on public.community_comments;
create trigger push_community_comment
after insert on public.community_comments
for each row execute function public.notify_community_comment();
