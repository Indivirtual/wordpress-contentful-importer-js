const fs = require('fs').promises;
const xml2js = require('xml2js');
const cms = require('contentful-management');
const mime = require('mime-types');

const config = require('./config');

let client = cms.createClient({
    accessToken: config.accessToken, 
});

let newCategories = [], 
    newTags = [], 
    newAuthors = [];

function createContentTypePromise(contentType, list, env) {
    
    return env.getContentType(contentType.id)
        .catch((e) => {
            let id = contentType.id;
            delete contentType.id;
            return env.createContentTypeWithId(id, contentType)
                .then(c => {
                    return c.publish()
                });
        })
        .then((contentType) => {
            console.log('Contentype created: ' + contentType.name);
            if (!list.length) {
                return Promise.resolve();
            }

            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(createContentTypePromise(list.shift(), list, env)), 
                    200)
            });
        });   
}

function createAuthorPromise(author, list, env) {
    
    return env.getEntry('author_' + author["wp:author_id"])
        .catch((e) => {
            return env.createEntryWithId('author', 'author_' + author["wp:author_id"], {
                fields: {
                    email: {
                        'nl-NL': author['wp:author_email'][0]
                    }, 
                    display_name: {
                        'nl-NL': author['wp:author_display_name'][0]
                    }, 
                    first_name: {
                        'nl-NL': author['wp:author_first_name'][0]
                    },
                    last_name: {
                        'nl-NL': author['wp:author_last_name'][0]
                    }, 
                    slug: {
                        'nl-NL': author['wp:author_login'][0]
                    }
                }
            });
        })
        .then((a) => {
            newAuthors.push(a);
            console.log('Author created: ' + a.sys.id);
            if (!list.length) {
                return Promise.resolve(newAuthors);
            }

            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(createAuthorPromise(list.shift(), list, env)), 
                    100)
            });
        });
    
}

function createCategoryPromise(category, list, env) {
    
    return env.getEntry('category_' + category["wp:term_id"])
        .catch((e) => {
            return env.createEntryWithId('category', 'category_' + category["wp:term_id"][0],  {
                fields: {
                    slug:  {
                        'nl-NL': category["wp:category_nicename"][0]
                    }, 
                    name: {
                        'nl-NL': category["wp:cat_name"][0]
                    }
                }
            
            });
        })
        .then((a) => {
            newCategories.push(a);
            console.log('Category created: ' + a.sys.id);
            if (!list.length) {
                return Promise.resolve(newCategories);
            }

            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(createCategoryPromise(list.shift(), list, env)), 
                    100)
            });
        });
}

function createTagPromise(tag, list, env) {
    
    return env.getEntry('tag_' + tag["wp:term_id"])
        .catch((e) => {
            return env.createEntryWithId('category', 'tag_' + tag["wp:term_id"],  {
                fields: {
                    slug:  {
                        'nl-NL': tag["wp:tag_slug"][0]
                    }, 
                    name: {
                        'nl-NL': tag["wp:tag_name"][0]
                    }
                }
            });
        })
        .then((a) => {
            newTags.push(a);
            console.log('Tag created: ' + a.sys.id);
            if (!list.length) {
                return Promise.resolve(newTags);
            }

            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(createTagPromise(list.shift(), list, env)), 
                    100);
            });
        });
}


function downloadAsset(url, imageName, env) {
    console.log('Downloading: ' + encodeURI(url));
    return env.getAsset(imageName)
        .catch((err) => {
            return env.createAsset({
                fields: {
                    title: {
                        'nl-NL': imageName
                    },
                    file: {
                        'nl-NL': {
                            contentType: mime.lookup(imageName),
                            fileName: imageName,
                            upload: encodeURI(url)
                        }
                    }
                }
            })
            .then((asset) => {
                return new Promise((resolve, reject) => {
                    return resolve(asset.processForLocale('nl-NL'))
                });
            });
        })
        .then((asset) => {
            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(asset), 
                    100);
            });
        })
        .catch((err) => {
            console.log("Error: ", err);
        })
}

function createImageAsset(match, matches, env, resultList) {
    //console.log('Post image found: ' + matches[i])

    if (!match) {
        return Promise.resolve(resultList);
    }

    let url = match[1];
    let urlParts = match[1].split('/');
    let imageName = urlParts[urlParts.length - 1];

    return downloadAsset(url, imageName, env)
        .then((asset) => {

            resultList.push({
                match: match, 
                asset: asset
            });
            
            return createImageAsset(matches.shift(), matches, env, resultList);
        })
}

function createPost(p, list, env, categoryCollection, authorCollection) {

    let post = p.post;
    let categoryWords = post["category"] ? post["category"].map(c => c.$["nicename"]) : [];
    let categories = categoryCollection.filter(c => categoryWords.includes(c.fields.slug['nl-NL']));

    let author = authorCollection.find((a) => post["dc:creator"][0] === a.fields.slug['nl-NL']);

    let postData = post["content:encoded"][0];

    let patt = new RegExp("<img.*?src=\"(.*?)\".*?alt=\"(.*?)\".*?/>", "gi");
				
    let m, 
        matches = [], 
        resultList = [];
    
    
    while((m = patt.exec(postData)) !== null) {
        matches.push(m);
    }

    return env.getEntry('post_' + post["wp:post_id"])
        .then((post) => {
            console.log(`Skipping ${post.sys.id}. Already created`);
            return Promise.resolve(post);
        })
        .catch((e) => {
            return createImageAsset(matches.shift(), matches, env, resultList)
                .then((results) => {
                    for (let i = 0; i < results.length; i++) {
                        postData = postData.replace(results[i].match[0], "![" + results[i].asset.fields.title['nl-NL'] + "](" + results[i].asset.fields.file['nl-NL'].url + ")");
                    }
                    
                    return Promise.resolve();
                })
                .then(() => new Promise((resolve, reject) => {
                    if (p.attachmentUrl) {
                        let urlParts = p.attachmentUrl.split('/');
                        let imageName = urlParts[urlParts.length - 1];
                        return resolve(downloadAsset(p.attachmentUrl, imageName, env));
                    } else {
                        return resolve(Promise.resolve());
                    }
                })
                .then((attachment) => {
                    return env.createEntryWithId('post', 'post_' + post["wp:post_id"],  {
                        fields: {
                            title:  {
                                'nl-NL': post["title"][0]
                            }, 
                            content:  {
                                'nl-NL': postData
                            }, 
                            author:  {
                                'nl-NL': {
                                    sys: {
                                        type: "Link", 
                                        linkType: "Entry",
                                        id: author.sys.id
                                    }
                                }
                            }, 
                            categories:  {
                                'nl-NL': categories.map(c => {
                                    return  {
                                        sys: {
                                            type: "Link", 
                                            linkType: "Entry",
                                            id: c.sys.id
                                        }
                                    }
                                })
                            },
                            wordpress_url: {
                                'nl-NL': post["link"][0]
                            },
                            slug: {
                                'nl-NL': post["wp:post_name"][0]
                            },
                            created_at: {
                                'nl-NL': new Date(post["pubDate"][0]).toISOString()
                            }, 
                            attachment: attachment ? {
                                'nl-NL': {
                                    sys: {
                                        type: "Link", 
                                        linkType: "Asset",
                                        id: attachment.sys.id
                                    }
                                }
                            } : null
                        }
                    });
            }));
            
        })
        .then((a) => {
            console.log('Post created: ' + a.sys.id);
            console.log('List length: ' + list.length)
            if (list.length <= 0) {
                return Promise.resolve();
            }

            return new Promise((resolve, reject) => {
                setTimeout(
                    resolve(createPost(list.shift(), list, env, categoryCollection, authorCollection)), 
                    100)
            });
        });
}

function parseXml(data) {
    var parser = new xml2js.Parser();

    return new Promise((resolve, reject) => {
        parser.parseString(data, (err, result) => {
            resolve(result);
        })
    })
}


fs.readFile(process.argv[2])
    .then((data) => {
        var xmlPromise = parseXml(data);

        return xmlPromise;
    })
    .then((parsed) => {

        client.getSpace(config.spaceId)
            .then((space) => space.getEnvironment(config.environment))
            .then((env) => {

                return fs.readFile(__dirname + '/contenttypes.json')
                    .then((data) => JSON.parse(data))
                    .then((parsedContentTypes) => {

                        return createContentTypePromise(parsedContentTypes.shift(), parsedContentTypes, env);
                    })
                    .then((result) => {
                        let authors = parsed.rss.channel[0]['wp:author']; 
                        return createAuthorPromise(authors.shift(), authors, env)
                            .then((newAuthors) => {
                                return Promise.resolve({
                                    authors: newAuthors
                                });
                            })
                    })
                    .then((result) => {
                        let categories = parsed.rss.channel[0]['wp:category']; 
                        return createCategoryPromise(categories.shift(), categories, env)
                            .then((newCategories) => {
                                result.categories = newCategories;
                                return Promise.resolve(result);
                            });
                    })
                    .then((result) => {
                        let tags = parsed.rss.channel[0]['wp:tag'];
                        return createTagPromise(tags.shift(), tags, env)
                            .then((newTags) => {
                                result.categories = [...result.categories, ...newTags];
                                return Promise.resolve(result);
                            });
                    })
                    .then((result) => {
                        let channel = parsed.rss.channel[0];
                        let posts = channel['item']
                            .filter(i => i["wp:post_type"][0] === "post" && i["wp:status"][0] === "publish")
                            .map(p => {
                                let post = {
                                    post: p
                                };

                                if (p["wp:postmeta"]) {
                                    let postAttachmentId = p["wp:postmeta"].find(m => m["wp:meta_key"][0] === "_thumbnail_id");
                                    if (postAttachmentId && postAttachmentId["wp:meta_value"]) {
                                        let attachmentItem = channel['item'].find(i => i["wp:post_id"][0] === postAttachmentId["wp:meta_value"][0]);
                                        
                                        post.attachmentUrl = attachmentItem["wp:attachment_url"][0];
                                    }
                                }
                                
                                return post;
                            })
                        return createPost(posts.shift(), posts, env, result.categories, result.authors);
                    })
            })
            .then((result) => {
                console.log("Finished");
            })
                
        });


