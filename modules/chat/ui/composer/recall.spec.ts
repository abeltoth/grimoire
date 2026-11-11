import { Recall } from './recall';

const sent = ['First', 'Second\nline', 'Third'];

describe('Recall', () => {
  it('brings back your messages from the last, and goes back to an empty page', () => {
    const recall = new Recall();
    expect(recall.step(1, sent, '', 0)).toEqual({ took: true, write: 'Third' });
    expect(recall.step(1, sent, 'Third', 5)).toEqual({ took: true, write: 'Second\nline' });
    expect(recall.step(-1, sent, 'Second\nline', 11)).toEqual({ took: true, write: 'Third' });
    expect(recall.step(-1, sent, 'Third', 5)).toEqual({ took: true, write: '' });
    expect(recall.step(-1, sent, '', 0)).toEqual({ took: false });
  });

  it('stays on your first message', () => {
    const recall = new Recall();
    recall.step(1, ['Only'], '', 0);
    expect(recall.step(1, ['Only'], 'Only', 4)).toEqual({ took: true });
  });

  it('moves the caret through a message of several lines, and in anything you wrote', () => {
    const recall = new Recall();
    recall.step(1, sent, '', 0);
    recall.step(1, sent, 'Third', 5);
    expect(recall.step(1, sent, 'Second\nline', 9)).toEqual({ took: false });
    expect(recall.step(-1, sent, 'Second\nline', 3)).toEqual({ took: false });
    expect(recall.step(1, sent, 'Something new', 0)).toEqual({ took: false });
  });

  it('forgets what came back for another chat', () => {
    const recall = new Recall();
    recall.step(1, sent, '', 0);
    recall.reset();
    expect(recall.step(1, sent, 'Third', 5)).toEqual({ took: false });
  });
});
