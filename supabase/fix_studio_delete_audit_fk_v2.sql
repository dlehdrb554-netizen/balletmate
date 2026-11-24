-- Fix studio deletion failure caused by audit rows inserted from cascading child deletes.
-- Keeps existing edit history when a studio is deleted; its studio_id becomes NULL.
-- Safe to execute more than once.

BEGIN;

ALTER TABLE public.studio_owner_edit_history
  ALTER COLUMN studio_id DROP NOT NULL;

DO $fix$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid=c.conrelid
     AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid='public.studio_owner_edit_history'::regclass
      AND c.contype='f'
      AND c.confrelid='public.studios'::regclass
      AND a.attname='studio_id'
  LOOP
    EXECUTE format('ALTER TABLE public.studio_owner_edit_history DROP CONSTRAINT %I',v_constraint.conname);
  END LOOP;
END
$fix$;

ALTER TABLE public.studio_owner_edit_history
  ADD CONSTRAINT studio_owner_edit_history_studio_id_fkey
  FOREIGN KEY (studio_id) REFERENCES public.studios(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.record_studio_owner_edit_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $ballet$
DECLARE
 v_old jsonb;v_new jsonb;v_studio_id uuid;v_entity_id text;v_action text;
 v_fields text[];
BEGIN
 -- Do not create child audit rows during a parent studio cascade delete.
 -- The studio row is being removed in the same transaction.
 -- Skip child audit inserts when the parent studio has already been removed by FK cascade.
 IF TG_OP='DELETE'
    AND TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices')
    AND NOT EXISTS (SELECT 1 FROM public.studios WHERE id=OLD.studio_id) THEN
  RETURN OLD;
 END IF;
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 v_action:=lower(TG_OP);
 IF TG_TABLE_NAME='studios' THEN
  IF TG_OP='DELETE' THEN
   v_studio_id:=OLD.id;v_entity_id:=OLD.id::text;
   v_old:=jsonb_build_object('name',OLD.name,'district',OLD.district,'address',OLD.address,'phone',OLD.phone,
    'website_url',OLD.website_url,'description',OLD.description,'image_urls',OLD.image_urls);
  ELSE
   v_studio_id:=NEW.id;v_entity_id:=NEW.id::text;
   v_new:=jsonb_build_object('name',NEW.name,'district',NEW.district,'address',NEW.address,'phone',NEW.phone,
    'website_url',NEW.website_url,'description',NEW.description,'image_urls',NEW.image_urls);
   IF TG_OP='UPDATE' THEN
    v_old:=jsonb_build_object('name',OLD.name,'district',OLD.district,'address',OLD.address,'phone',OLD.phone,
     'website_url',OLD.website_url,'description',OLD.description,'image_urls',OLD.image_urls);
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('studio_public_prices','studio_public_schedules','studio_owner_notices') THEN
  IF TG_OP='DELETE' THEN v_studio_id:=OLD.studio_id;v_entity_id:=OLD.id::text; ELSE v_studio_id:=NEW.studio_id;v_entity_id:=NEW.id::text; END IF;
  IF TG_OP='DELETE' THEN v_old:=to_jsonb(OLD); ELSE v_new:=to_jsonb(NEW); IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); END IF; END IF;
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
  INSERT INTO public.studio_owner_edit_history(studio_id,actor_user_id,entity,entity_id,action,changed_fields,before_snapshot,after_snapshot)
  VALUES(v_studio_id,auth.uid(),TG_TABLE_NAME,v_entity_id,v_action,v_fields,v_old,v_new);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $ballet$;

COMMIT;
