let dragEndedWithMove = false;

export const signalDragCompleted = () => {
  dragEndedWithMove = true;
};

export const clearDragCompleted = () => {
  dragEndedWithMove = false;
};

export const consumeDragCompleted = () => {
  if (!dragEndedWithMove) {
    return false;
  }
  dragEndedWithMove = false;
  return true;
};
