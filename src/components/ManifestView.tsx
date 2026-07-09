import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ChevronRight, ChevronDown, ShieldCheck, Columns3, Table2, Eye } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { DetectedEntity } from '../types';
import ReviewPdfViewer from './ReviewPdfViewer';
import ReviewDocxViewer from './ReviewDocxViewer';

const ENTITY_LABELS: Record<string, string> = {
  PERSON: 'Person', EMAIL_ADDRESS: 'Email', PHONE_NUMBER: 'Phone',
  LOCATION: 'Address', CREDIT_CARD: 'Credit Card', US_SSN: 'SSN',
  DATE_OF_BIRTH: 'Date of Birth', PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License", IP_ADDRESS: 'IP Address',
  URL: 'URL', BANK_ACCOUNT: 'Bank Account', MEDICAL_RECORD: 'Medical Record',
  ORGANIZATION: 'Organization', INSURANCE_ID: 'Insurance',
  ROUTING_NUMBER: 'Routing Number', TAX_ID: 'Tax ID',
  NATIONAL_ID: 'National ID', VEHICLE_REGISTRATION: 'Vehicle Reg.',
};

interface EntityGroupData {
  type: string;
  label: string;
  items: Array<{ index: number; entity: DetectedEntity }>;
}

function DetectedEntityItem({
  entity,
  onToggle,
}: {
  entity: DetectedEntity;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/60 hover:bg-slate-800/40 transition-colors group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entity.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className={`text-sm truncate ${entity.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>
          {entity.text}
        </span>
      </div>
      <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0 ml-2 ${entity.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
        <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${entity.enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
      </div>
    </button>
  );
}

function EntityGroupSection({
  group,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleItem,
}: {
  group: EntityGroupData;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: () => void;
  onToggleItem: (index: number) => void;
}) {
  const enabledCount = group.items.filter((i) => i.entity.enabled).length;
  const allEnabled = enabledCount === group.items.length;
  const someEnabled = enabledCount > 0 && !allEnabled;

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800/40 overflow-hidden">
      <div className="flex items-center">
        <button
          onClick={onToggleExpand}
          className="flex-1 flex items-center gap-2.5 px-4 py-3 hover:bg-slate-800/40 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
          <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${enabledCount > 0 ? 'text-emerald-400' : 'text-slate-600'}`} />
          <span className="text-sm text-white font-medium">{group.label}</span>
          <span className="text-[10px] text-slate-500 font-mono">
            {enabledCount}/{group.items.length}
          </span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleAll(); }}
          className="px-4 py-3 hover:bg-slate-800/40 transition-colors flex-shrink-0"
          title={allEnabled ? 'Deselect all' : 'Select all'}
        >
          <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
            allEnabled ? 'bg-emerald-500' : someEnabled ? 'bg-emerald-500/50' : 'bg-slate-700'
          }`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              allEnabled || someEnabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`} />
          </div>
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
              {group.items.map(({ index, entity }) => (
                <DetectedEntityItem
                  key={index}
                  entity={entity}
                  onToggle={() => onToggleItem(index)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ColumnRow({ column, selected, onToggle }: { column: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800/40 hover:bg-slate-800/60 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Columns3 className={`w-4 h-4 flex-shrink-0 ${selected ? 'text-emerald-400' : 'text-slate-600'}`} />
        <p className="text-sm text-white font-medium truncate">{column}</p>
      </div>
      <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${selected ? 'bg-emerald-500' : 'bg-slate-700'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${selected ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
      </div>
    </button>
  );
}

interface ManifestViewProps {
  onConfirm: () => void;
  onColumnRedact?: () => void;
  isRedacting?: boolean;
  isConfirming?: boolean;
}

export default function ManifestView({ onConfirm, onColumnRedact, isRedacting, isConfirming }: ManifestViewProps) {
  const { pendingScanResult, scanningFileName, toggleEntity, toggleDetectedEntity, toggleDetectedEntityType, toggleDetectedEntityIndices, addCustomEntity, selectedColumns, toggleColumn } = useAppStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const detectedEntities = pendingScanResult?.detected_entities;
  const hasDetectedEntities = detectedEntities && detectedEntities.length > 0;

  const groups = useMemo<EntityGroupData[]>(() => {
    if (!detectedEntities) return [];
    const map = new Map<string, EntityGroupData>();
    detectedEntities.forEach((ent, index) => {
      if (!map.has(ent.entity_type)) {
        map.set(ent.entity_type, {
          type: ent.entity_type,
          label: ENTITY_LABELS[ent.entity_type] || ent.entity_type,
          items: [],
        });
      }
      map.get(ent.entity_type)!.items.push({ index, entity: ent });
    });
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [detectedEntities]);

  const totalEnabled = detectedEntities?.filter((e) => e.enabled).length ?? 0;
  const totalDetected = detectedEntities?.length ?? 0;

  if (!pendingScanResult) return null;

  const isColumnMode = pendingScanResult.columns && pendingScanResult.columns.length > 0;

  if (isColumnMode) {
    const columns = pendingScanResult.columns!;
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="max-w-md w-full mx-4">
          <div className="text-center mb-6">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3"
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">Spreadsheet Detected</span>
            </motion.div>
            <h2 className="text-2xl font-bold text-white mb-1">Choose Columns to Redact</h2>
            <p className="text-sm text-slate-400">
              {columns.length} columns found — select which ones contain sensitive data
            </p>
          </div>

          <div className="space-y-2 mb-6 max-h-[40vh] overflow-y-auto pr-1">
            {columns.map((col) => (
              <ColumnRow
                key={col}
                column={col}
                selected={selectedColumns.includes(col)}
                onToggle={() => toggleColumn(col)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800/40 mb-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">Columns to redact</span>
            </div>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
              {selectedColumns.length} / {columns.length}
            </span>
          </div>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onColumnRedact}
            disabled={selectedColumns.length === 0 || isRedacting}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRedacting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Redacting…</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Redact Selected Columns</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    );
  }

  if (!pendingScanResult.entities && !hasDetectedEntities) return null;

  // Entity review mode with individual entity controls
  if (hasDetectedEntities) {
    const toggleGroupExpand = (type: string) => {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      });
    };

    const lowerName = scanningFileName.toLowerCase();
    const isPdf = lowerName.endsWith('.pdf');
    const isDocx = lowerName.endsWith('.docx');
    const hasInlineReview = isPdf || isDocx;

    const confirmButton = (
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={onConfirm}
        disabled={isConfirming}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isConfirming ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Applying redaction…</span>
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4" />
            <span>Apply Redaction</span>
            <ChevronRight className="w-4 h-4" />
          </>
        )}
      </motion.button>
    );

    const counterPill = (
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800/40">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-300">Entities to redact</span>
        </div>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
          {totalEnabled} / {totalDetected}
        </span>
      </div>
    );

    if (hasInlineReview) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="fixed inset-0 flex flex-col pt-20 pb-6 px-6 gap-4"
        >
          <div className="flex items-center justify-between flex-shrink-0 gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">Review Step</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white leading-tight truncate">{scanningFileName}</h2>
                <p className="text-xs text-slate-400 truncate">
                  {totalDetected} entities across {pendingScanResult.page_count} pages · click a highlight to toggle · select text to redact custom
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
                {totalEnabled} / {totalDetected} redacted
              </span>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onConfirm}
                disabled={isConfirming}
                className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isConfirming ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Applying…</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Apply Redaction</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            {isPdf ? (
              <ReviewPdfViewer
                sessionId={pendingScanResult.session_id}
                detectedEntities={pendingScanResult.detected_entities!}
                onToggleIndices={toggleDetectedEntityIndices}
                onAddCustom={addCustomEntity}
              />
            ) : (
              <ReviewDocxViewer
                sessionId={pendingScanResult.session_id}
                detectedEntities={pendingScanResult.detected_entities!}
                onToggleIndices={toggleDetectedEntityIndices}
                onAddCustom={addCustomEntity}
              />
            )}
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="max-w-md w-full mx-4">
          <div className="text-center mb-6">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3"
            >
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">Review Step</span>
            </motion.div>
            <h2 className="text-2xl font-bold text-white mb-1">Review Detected Entities</h2>
            <p className="text-sm text-slate-400">
              {totalDetected} entities detected across {pendingScanResult.page_count} pages.
              <br />
              Toggle items to control what gets redacted before sending to AI.
            </p>
          </div>

          <div className="space-y-2 mb-6 max-h-[45vh] overflow-y-auto pr-1">
            {groups.map((group) => (
              <EntityGroupSection
                key={group.type}
                group={group}
                expanded={expandedGroups.has(group.type)}
                onToggleExpand={() => toggleGroupExpand(group.type)}
                onToggleAll={() => toggleDetectedEntityType(group.type)}
                onToggleItem={(index) => toggleDetectedEntity(index)}
              />
            ))}
          </div>

          <div className="mb-4">{counterPill}</div>

          {confirmButton}
        </div>
      </motion.div>
    );
  }

  // Fallback: legacy category-level view (for old sessions without detected_entities)
  const entities = pendingScanResult.entities;
  const enabledCount = entities
    .filter((e) => e.enabled)
    .reduce((sum, e) => sum + e.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="min-h-screen flex items-center justify-center"
    >
      <div className="max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">Scan Complete</span>
          </motion.div>
          <h2 className="text-2xl font-bold text-white mb-1">Sensitive Data Found</h2>
          <p className="text-sm text-slate-400">
            {pendingScanResult.total_entities} PII entities detected across {pendingScanResult.page_count} pages
          </p>
        </div>

        <div className="space-y-2 mb-6 max-h-[40vh] overflow-y-auto pr-1">
          {entities.map((entity, index) => {
            const label = ENTITY_LABELS[entity.type] || entity.type;
            return (
              <button
                key={entity.type}
                onClick={() => toggleEntity(index)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800/40 hover:bg-slate-800/60 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${entity.enabled ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium">{label}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {entity.count} found · {entity.examples.slice(0, 2).join(', ')}
                    </p>
                  </div>
                </div>
                <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${entity.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${entity.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800/40 mb-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">Entities to redact</span>
          </div>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
            {enabledCount}
          </span>
        </div>

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={onConfirm}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:from-emerald-500 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
        >
          <Lock className="w-4 h-4" />
          <span>Apply Redaction</span>
          <ChevronRight className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
}
