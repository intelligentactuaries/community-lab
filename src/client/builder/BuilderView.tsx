// Build mode: the library, the drawing board with its tool rail, and the
// properties, under the builder's own top bar.

import { BuilderCanvas } from './BuilderCanvas';
import { BuilderBar, PlansDialog, ToolRail } from './BuilderChrome';
import { useBuilder } from './builderStore';
import { Library } from './Library';
import { Properties } from './Properties';

export function BuilderView() {
  const b = useBuilder();
  return (
    <>
      <BuilderBar />
      <div className="body b-body">
        <Library />
        <div className="stage-wrap">
          {b.plan ? <BuilderCanvas /> : <div className="stage b-empty"><span className="muted">Start a world from the dialog.</span></div>}
          {b.plan && <ToolRail />}
          {b.notice && <div className={`b-notice ${b.notice.tone}`}>{b.notice.text}</div>}
        </div>
        <Properties />
      </div>
      <PlansDialog />
    </>
  );
}
