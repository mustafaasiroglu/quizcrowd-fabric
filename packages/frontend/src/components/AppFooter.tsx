import { useState } from 'react';
import { Modal } from './Modal';

export function AppFooter() {
  const [about, setAbout] = useState(false);
  return <>
    <footer><span>QuizCrowd for Microsoft Fabric</span><span aria-hidden="true"> · </span><button type="button" className="footer-about" onClick={() => setAbout(true)}>About</button></footer>
    {about && <Modal title="About QuizCrowd" onClose={() => setAbout(false)}>
      <div className="about-content">
        <p>QuizCrowd Fabric app is created by <a href="https://tr.linkedin.com/in/mustafaasiroglu" target="_blank" rel="noopener noreferrer">Mustafa Asiroglu</a>, and its source code is available on <a href="https://github.com/mustafaasiroglu/quizcrowd-fabric" target="_blank" rel="noopener noreferrer">GitHub</a>.</p>
        <p>If you have feature ideas or feedback, feel free to reach out or <a href="https://github.com/mustafaasiroglu/quizcrowd-fabric/issues/new" target="_blank" rel="noopener noreferrer">create an issue on GitHub</a>.</p>
      </div>
    </Modal>}
  </>;
}
