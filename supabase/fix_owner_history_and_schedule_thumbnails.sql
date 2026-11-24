-- Repair owner edit-history trigger compatibility and expose schedule image URLs.
-- Safe to run repeatedly in Supabase SQL Editor.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_studio_owner_edit_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $ballet$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_studio_id uuid;
  v_entity_id text;
  v_action text;
  v_fields text[];
  v_old_studio_id uuid;
BEGIN
  -- Read studio_id through JSON so this trigger never assumes every OLD record
  -- has that column. This prevents "record old has no field studio_id".
  IF TG_OP='DELETE'
     AND TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices') THEN
    v_old_studio_id:=NULLIF(to_jsonb(OLD)->>'studio_id','')::uuid;
    IF v_old_studio_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.studios WHERE id=v_old_studio_id) THEN
      RETURN OLD;
    END IF;
  END IF;

  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN
    RETURN OLD;
  END IF;

  v_action:=lower(TG_OP);

  IF TG_TABLE_NAME='studios' THEN
    IF TG_OP='DELETE' THEN
      v_studio_id:=OLD.id;
      v_entity_id:=OLD.id::text;
      v_old:=jsonb_build_object(
        'name',OLD.name,'district',OLD.district,'address',OLD.address,
        'phone',OLD.phone,'website_url',OLD.website_url,
        'description',OLD.description,'image_urls',OLD.image_urls
      );
    ELSE
      v_studio_id:=NEW.id;
      v_entity_id:=NEW.id::text;
      v_new:=jsonb_build_object(
        'name',NEW.name,'district',NEW.district,'address',NEW.address,
        'phone',NEW.phone,'website_url',NEW.website_url,
        'description',NEW.description,'image_urls',NEW.image_urls
      );
      IF TG_OP='UPDATE' THEN
        v_old:=jsonb_build_object(
          'name',OLD.name,'district',OLD.district,'address',OLD.address,
          'phone',OLD.phone,'website_url',OLD.website_url,
          'description',OLD.description,'image_urls',OLD.image_urls
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices') THEN
    IF TG_OP='DELETE' THEN
      v_studio_id:=NULLIF(to_jsonb(OLD)->>'studio_id','')::uuid;
      v_entity_id:=OLD.id::text;
      v_old:=to_jsonb(OLD);
    ELSE
      v_studio_id:=NULLIF(to_jsonb(NEW)->>'studio_id','')::uuid;
      v_entity_id:=NEW.id::text;
      v_new:=to_jsonb(NEW);
      IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); END IF;
    END IF;

    IF TG_TABLE_NAME='studio_public_prices' THEN
      v_fields:=ARRAY['amount_krw','price_period','frequency_per_week','image_urls','is_active','expires_at'];
      v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','published_by','id'] END;
      v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
    ELSIF TG_TABLE_NAME='studio_public_schedules' THEN
      v_fields:=ARRAY['schedule_text','image_urls','is_active','expires_at'];
      v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
      v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['candidate_id','evidence_text','source_url','source_title','source_post_date','published_at','studio_id','created_at','updated_at','id'] END;
    ELSE
      v_fields:=ARRAY['title','body','is_active'];
      v_old:=CASE WHEN v_old IS NULL THEN NULL ELSE v_old-ARRAY['created_by','studio_id','created_at','updated_at','id'] END;
      v_new:=CASE WHEN v_new IS NULL THEN NULL ELSE v_new-ARRAY['created_by','studio_id','created_at','updated_at','id'] END;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported audit table: %',TG_TABLE_NAME;
  END IF;

  IF TG_OP='UPDATE' THEN
    SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
    FROM jsonb_object_keys(coalesce(v_new,'{}'::jsonb)) AS keys(k)
    WHERE coalesce(v_old,'{}'::jsonb)->k IS DISTINCT FROM v_new->k;
  ELSIF TG_OP='INSERT' THEN
    SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
    FROM jsonb_object_keys(coalesce(v_new,'{}'::jsonb)) AS keys(k);
  ELSE
    SELECT coalesce(array_agg(k ORDER BY k),'{}') INTO v_fields
    FROM jsonb_object_keys(coalesce(v_old,'{}'::jsonb)) AS keys(k);
  END IF;

  IF TG_OP<>'UPDATE' OR cardinality(v_fields)>0 THEN
    INSERT INTO public.studio_owner_edit_history(
      studio_id,actor_user_id,entity,entity_id,action,changed_fields,before_snapshot,after_snapshot
    ) VALUES (
      v_studio_id,auth.uid(),TG_TABLE_NAME,v_entity_id,v_action,v_fields,v_old,v_new
    );
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$ballet$;

CREATE OR REPLACE VIEW public.studio_public_schedules_app
WITH (security_invoker = true) AS
SELECT
  s.id,s.studio_id,s.schedule_text,s.evidence_text,s.source_title,
  s.source_url,s.source_post_date,s.published_at,s.expires_at,s.image_urls
FROM public.studio_public_schedules s
WHERE s.is_active=true
  AND (s.expires_at IS NULL OR s.expires_at>=CURRENT_DATE);

GRANT SELECT ON public.studio_public_schedules_app TO anon,authenticated;

COMMIT;
