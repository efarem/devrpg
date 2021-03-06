const got = require('got');
const atob = require('atob');
const jsdiff = require('diff');
const Project = require('./project');
const Commit = require('./commit');
const File = require('./file');

class GitLab {
  constructor(config) {
    this.url = config.url;
    this.token = config.token;
  }

  /**
   * Make a query to GitLab
   * @param string path
   * @return Promise
   */
  query(path) {
    return new Promise((resolve, reject) => {
      const url = `${this.url}/api/v3/${path}`;
      got(url, { headers: { 'PRIVATE-TOKEN': this.token } })
        .then((response) => {
          resolve(JSON.parse(response.body));
        })
        .catch((err) => {
          reject(err.response.body);
        });
    });
  }

  /**
   * Get a project
   * @param integer/string projectName
   * @return Promise
   */
  getProject(projectName) {
    return new Promise((resolve) => {
      this.query(`projects/${encodeURIComponent(projectName)}`).then((projectData) => {
        resolve(new Project({
          id: projectData.id,
          name: projectData.name,
          description: projectData.description,
          namespace: projectData.namespace.name,
          url: projectData.web_url,
          path: projectData.path_with_namespace,
          tags: projectData.tag_list,
        }));
      });
    });
  }

  /**
   * Diff a file
   * @param Commit commit
   * @param string filename
   * @param string status
   * @return Promise
   */
  diffFile(commit, filename, status) {
    return new Promise((resolve, reject) => {

      const file = new File({
        name: filename,
        project: commit.getProject(),
      });

      // Check that file and commit properties are valid
      if (file.isIgnored() || !file.getSkill()) {
        reject(`${filename} @ #${commit.getID()}: ignored or unskilled file`);
      } else {
        this.query(`projects/${commit.getProject().getID()}/repository/commits/${commit.getID()}`).then((commitData) => {
          if (!commitData) {
            reject(`${filename} @ #${commit.getID()}: error loading commit data`);
          } else if (commitData.parent_ids.length > 1) {
            reject(`${filename} @ #${commit.getID()}: commit was a merge`);
          } else if (new Date().getMonth() !== new Date(commitData.created_at).getMonth()) {
            reject(`${filename} @ #${commit.getID()}: commit was not made this month`);
          } else {

            // Fetch file content
            this.fetchFileContent(commit, file).then((newFile) => {

              // Add all lines if addition or initial commit
              if (status === 'addition' || commitData.parent_ids.length === 0) {
                console.log(`${filename} @ #${commit.getID()}: detected addition`);
                newFile.setAdditions(newFile.getLines());
                resolve(newFile);

              // Fetch parent if removal or modified
              } else {
                this.fetchFileContent(new Commit({
                  id: commitData.parent_ids[0],
                  project: commit.getProject(),
                }), new File({
                  name: filename,
                  project: commit.getProject(),
                })).then((oldFile) => {

                  // Remove all lines if removal
                  if (status === 'removal' || newFile.getContent() === false) {
                    console.log(`${filename} @ #${commit.getID()}: detected removal`);
                    oldFile.setAdditions(-oldFile.getLines());
                    resolve(oldFile);

                  // Check if it's an addition instead of a modification
                  } else if (oldFile.getContent() === false) {
                    console.log(`${filename} @ #${commit.getID()}: detected addition`);
                    newFile.setAdditions(newFile.getLines());
                    resolve(newFile);

                  // Calculate diff if modified
                  } else {

                    const diff = jsdiff.structuredPatch(
                      oldFile.getName(),
                      newFile.getName(),
                      atob(oldFile.getContent()),
                      atob(newFile.getContent()),
                      '', ''
                    );

                    if (diff.hunks.length > 0) {
                      diff.hunks.forEach((hunk) => {
                        newFile.addAdditions(hunk.newLines - hunk.oldLines);
                      });
                      console.log(`${filename} @ #${commit.getID()}: parsed ${diff.hunks.length} diff(s)`);
                    } else {
                      console.log(`${filename} @ #${commit.getID()}: no diffs found`);
                    }
                    resolve(newFile);
                  }
                });
              }
            });
          }
        });
      }

    });
  }

  /**
   * Fetch file content
   * @param Commit commit
   * @param File file
   * @return Promise
   */
  fetchFileContent(commit, file) {
    return new Promise((resolve) => {
      this.query(`projects/${commit.getProject().getID()}/repository/files?file_path=${encodeURI(file.getName())}&ref=${commit.getID()}`)
        .then((response) => {
          if (response) {
            file.setContent(response.content);
          }
          resolve(file);
        })
        .catch((err) => {
          const message = JSON.parse(err).message;
          console.log(`${file.getName()} @ #${commit.getID()}: error loading file content - ${message}`);
          resolve(file);
        });
    });
  }
}

module.exports = GitLab;
