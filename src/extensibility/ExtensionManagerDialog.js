/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

define(function (require, exports, module) {


    var _                           = require("thirdparty/lodash"),
        Mustache                    = require("thirdparty/mustache/mustache"),
        Dialogs                     = require("widgets/Dialogs"),
        DefaultDialogs              = require("widgets/DefaultDialogs"),
        FileSystem                  = require("filesystem/FileSystem"),
        FileUtils                   = require("file/FileUtils"),
        Package                     = require("extensibility/Package"),
        Strings                     = require("strings"),
        StringUtils                 = require("utils/StringUtils"),
        Commands                    = require("command/Commands"),
        CommandManager              = require("command/CommandManager"),
        InstallExtensionDialog      = require("extensibility/InstallExtensionDialog"),
        AppInit                     = require("utils/AppInit"),
        Async                       = require("utils/Async"),
        KeyEvent                    = require("utils/KeyEvent"),
        ExtensionManager            = require("extensibility/ExtensionManager"),
        ExtensionManagerView        = require("extensibility/ExtensionManagerView").ExtensionManagerView,
        ExtensionManagerViewModel   = require("extensibility/ExtensionManagerViewModel"),
        PreferencesManager          = require("preferences/PreferencesManager"),
        Metrics                     = require("utils/Metrics");

    var dialogTemplate    = require("text!htmlContent/extension-manager-dialog.html");

    // bootstrap tabs component
    require("widgets/bootstrap-tab");

    var _activeTabIndex;

    function _stopEvent(event) {
        event.stopPropagation();
        event.preventDefault();
    }

    /**
     * @private
     * Triggers changes requested by the dialog UI.
     */
    function _performChanges() {
        // If an extension was removed or updated, prompt the user to quit Brackets.
        var hasRemovedExtensions    = ExtensionManager.hasExtensionsToRemove(),
            hasUpdatedExtensions    = ExtensionManager.hasExtensionsToUpdate(),
            hasDisabledExtensions   = ExtensionManager.hasExtensionsToDisable();
        if (!hasRemovedExtensions && !hasUpdatedExtensions && !hasDisabledExtensions) {
            return;
        }

        var buttonLabel = Strings.CHANGE_AND_RELOAD;
        if (hasRemovedExtensions && !hasUpdatedExtensions && !hasDisabledExtensions) {
            buttonLabel = Strings.REMOVE_AND_RELOAD;
        } else if (hasUpdatedExtensions && !hasRemovedExtensions && !hasDisabledExtensions) {
            buttonLabel = Strings.UPDATE_AND_RELOAD;
        } else if (hasDisabledExtensions && !hasRemovedExtensions && !hasUpdatedExtensions) {
            buttonLabel = Strings.DISABLE_AND_RELOAD;
        }

        var dlg = Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_CHANGE_EXTENSIONS,
            Strings.CHANGE_AND_RELOAD_TITLE,
            Strings.CHANGE_AND_RELOAD_MESSAGE,
            [
                {
                    className: Dialogs.DIALOG_BTN_CLASS_NORMAL,
                    id: Dialogs.DIALOG_BTN_CANCEL,
                    text: Strings.CANCEL
                },
                {
                    className: Dialogs.DIALOG_BTN_CLASS_PRIMARY,
                    id: Dialogs.DIALOG_BTN_OK,
                    text: buttonLabel
                }
            ],
            false
        ),
            $dlg = dlg.getElement();

        $dlg.one("buttonClick", function (e, buttonId) {
            if (buttonId === Dialogs.DIALOG_BTN_OK) {
                // Disable the dialog buttons so the user can't dismiss it,
                // and show a message indicating that we're doing the updates,
                // in case it takes a long time.
                $dlg.find(".dialog-button").prop("disabled", true);
                $dlg.find(".close").hide();
                $dlg.find(".dialog-message")
                    .text(Strings.PROCESSING_EXTENSIONS)
                    .append("<span class='spinner inline spin'/>");

                var removeExtensionsPromise,
                    updateExtensionsPromise,
                    disableExtensionsPromise,
                    removeErrors,
                    updateErrors,
                    disableErrors;

                removeExtensionsPromise = ExtensionManager.removeMarkedExtensions()
                    .fail(function (errorArray) {
                        removeErrors = errorArray;
                    });
                updateExtensionsPromise = ExtensionManager.updateExtensions()
                    .fail(function (errorArray) {
                        updateErrors = errorArray;
                    });
                disableExtensionsPromise = ExtensionManager.disableMarkedExtensions()
                    .fail(function (errorArray) {
                        disableErrors = errorArray;
                    });

                Async.waitForAll([removeExtensionsPromise, updateExtensionsPromise, disableExtensionsPromise], true)
                    .always(function () {
                        dlg.close();
                    })
                    .done(function () {
                        CommandManager.execute(Commands.APP_RELOAD);
                    })
                    .fail(function () {
                        var ids = [],
                            dialogs = [];

                        function nextDialog() {
                            var dialog = dialogs.shift();
                            if (dialog) {
                                Dialogs.showModalDialog(dialog.dialog, dialog.title, dialog.message)
                                    .done(nextDialog);
                            } else {
                                // Even in case of error condition, we still have to reload
                                CommandManager.execute(Commands.APP_RELOAD);
                            }
                        }

                        if (removeErrors) {
                            removeErrors.forEach(function (errorObj) {
                                ids.push(errorObj.item);
                            });
                            dialogs.push({
                                dialog: DefaultDialogs.DIALOG_ID_ERROR,
                                title: Strings.EXTENSION_MANAGER_REMOVE,
                                message: StringUtils.format(Strings.EXTENSION_MANAGER_REMOVE_ERROR, ids.join(", "))
                            });
                        }

                        if (updateErrors) {
                            // This error case should be very uncommon.
                            // Just let the user know that we couldn't update
                            // this extension and log the errors to the console.
                            ids.length = 0;
                            updateErrors.forEach(function (errorObj) {
                                ids.push(errorObj.item);
                                if (errorObj.error && errorObj.error.forEach) {
                                    console.error("Errors for", errorObj.item);
                                    errorObj.error.forEach(function (error) {
                                        console.error(Package.formatError(error));
                                    });
                                } else {
                                    console.error("Error for", errorObj.item, errorObj);
                                }
                            });
                            dialogs.push({
                                dialog: DefaultDialogs.DIALOG_ID_ERROR,
                                title: Strings.EXTENSION_MANAGER_UPDATE,
                                message: StringUtils.format(Strings.EXTENSION_MANAGER_UPDATE_ERROR, ids.join(", "))
                            });
                        }

                        if (disableErrors) {
                            ids.length = 0;
                            disableErrors.forEach(function (errorObj) {
                                ids.push(errorObj.item);
                            });
                            dialogs.push({
                                dialog: DefaultDialogs.DIALOG_ID_ERROR,
                                title: Strings.EXTENSION_MANAGER_DISABLE,
                                message: StringUtils.format(Strings.EXTENSION_MANAGER_DISABLE_ERROR, ids.join(", "))
                            });
                        }

                        nextDialog();
                    });
            } else {
                dlg.close();
                ExtensionManager.cleanupUpdates();
                ExtensionManager.unmarkAllForRemoval();
                ExtensionManager.unmarkAllForDisabling();
            }
        });
    }


    const installFromZipSupported = false;
    /**
     * @private
     * Install extensions from the local file system using the install dialog.
     * @return {$.Promise}
     */
    function _installUsingDragAndDrop(files) {
        Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "install", "dropZip");
        if(!installFromZipSupported){
            return new $.Deferred().reject(files).promise();
        }
        var installZips = [],
            updateZips = [],
            deferred = new $.Deferred(),
            validatePromise;

        brackets.app.getDroppedFiles(function (err, paths) {
            if (err) {
                // Only possible error is invalid params, silently ignore
                console.error(err);
                deferred.resolve();
                return;
            }

            // Parse zip files and separate new installs vs. updates
            validatePromise = Async.doInParallel_aggregateErrors(paths, function (path) {
                var result = new $.Deferred();

                FileSystem.resolve(path, function (err, file) {
                    var extension = FileUtils.getFileExtension(path),
                        isZip = file.isFile && (extension === "zip"),
                        errStr;

                    if (err) {
                        errStr = FileUtils.getFileErrorString(err);
                    } else if (!isZip) {
                        errStr = Strings.INVALID_ZIP_FILE;
                    }

                    if (errStr) {
                        result.reject(errStr);
                        return;
                    }

                    // Call validate() so that we open the local zip file and parse the
                    // package.json. We need the name to detect if this zip will be a
                    // new install or an update.
                    Package.validate(path, { requirePackageJSON: true }).done(function (info) {
                        if (info.errors.length) {
                            result.reject(info.errors.map(Package.formatError).join(" "));
                            return;
                        }

                        var extensionName = info.metadata.name,
                            extensionInfo = ExtensionManager.extensions[extensionName],
                            isUpdate = extensionInfo && !!extensionInfo.installInfo;

                        if (isUpdate) {
                            updateZips.push(file);
                        } else {
                            installZips.push(file);
                        }

                        result.resolve();
                    }).fail(function (err) {
                        result.reject(Package.formatError(err));
                    });
                });

                return result.promise();
            });

            validatePromise.done(function () {
                var installPromise = Async.doSequentially(installZips, function (file) {
                    return InstallExtensionDialog.installUsingDialog(file);
                });

                var updatePromise = installPromise.then(function () {
                    return Async.doSequentially(updateZips, function (file) {
                        return InstallExtensionDialog.updateUsingDialog(file).done(function (result) {
                            ExtensionManager.updateFromDownload(result);
                        });
                    });
                });

                // InstallExtensionDialog displays it's own errors, always
                // resolve the outer promise
                updatePromise.always(deferred.resolve);
            }).fail(function (errorArray) {
                deferred.reject(errorArray);
            });
        });

        return deferred.promise();
    }

    /**
     * @private
     * Show a dialog that allows the user to browse and manage extensions.
     */
    function _showDialog() {
        Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "dialogue", "shown");

        var dialog,
            $dlg,
            views   = [],
            $search,
            $searchClear,
            $modalDlg,
            context = { Strings: Strings, showRegistry: !!brackets.config.extension_registry },
            models  = [];

        // Load registry only if the registry URL exists
        if (context.showRegistry) {
            models.push(new ExtensionManagerViewModel.RegistryViewModel());
            models.push(new ExtensionManagerViewModel.ThemesViewModel());
        }

        models.push(new ExtensionManagerViewModel.InstalledViewModel());
        models.push(new ExtensionManagerViewModel.DefaultViewModel());

        function updateSearchDisabled() {
            var model           = models[_activeTabIndex],
                searchDisabled  = ($search.val() === "") &&
                                  (!model.filterSet || model.filterSet.length === 0);

            $search.prop("disabled", searchDisabled);
            $searchClear.prop("disabled", searchDisabled);

            return searchDisabled;
        }

        function clearSearch() {
            $search.val("");
            views.forEach(function (view, index) {
                view.filter("");
                $modalDlg.scrollTop(0);
            });

            if (!updateSearchDisabled()) {
                $search.focus();
            }
        }

        // Open the dialog
        dialog = Dialogs.showModalDialogUsingTemplate(Mustache.render(dialogTemplate, context));

        // On dialog close: clean up listeners & models, and commit changes
        dialog.done(function () {
            $(window.document).off(".extensionManager");

            models.forEach(function (model) {
                model.dispose();
            });

            _performChanges();
        });

        // Create the view.
        $dlg = dialog.getElement();
        $search = $(".search", $dlg);
        $searchClear = $(".search-clear", $dlg);
        $modalDlg = $(".modal-body", $dlg);

        function setActiveTab($tab) {
            if (models[_activeTabIndex]) {
                models[_activeTabIndex].scrollPos = $modalDlg.scrollTop();
            }
            $tab.tab("show");
            if (models[_activeTabIndex]) {
                $modalDlg.scrollTop(models[_activeTabIndex].scrollPos || 0);
                clearSearch();
                if (_activeTabIndex === 2) {
                    $(".ext-sort-group").hide();
                } else {
                    $(".ext-sort-group").show();
                }
            }
        }

        // Dialog tabs
        $dlg.find(".nav-tabs a")
            .on("click", function (event) {
                setActiveTab($(this));
            });

        // Navigate through tabs via Ctrl-(Shift)-Tab
        // (focus may be on document.body if text in extension listing clicked - see #9511)
        $(window.document).on("keyup.extensionManager", function (event) {
            if (event.keyCode === KeyEvent.DOM_VK_TAB && event.ctrlKey) {
                var $tabs = $(".nav-tabs a", $dlg),
                    tabIndex = _activeTabIndex;

                if (event.shiftKey) {
                    tabIndex--;
                } else {
                    tabIndex++;
                }
                tabIndex %= $tabs.length;
                setActiveTab($tabs.eq(tabIndex));
            }
        });

        // Update & hide/show the notification overlay on a tab's icon, based on its model's notifyCount
        function updateNotificationIcon(index) {
            var model = models[index],
                $notificationIcon = $dlg.find(".nav-tabs li").eq(index).find(".notification");
            if (model.notifyCount) {
                $notificationIcon.text(model.notifyCount);
                $notificationIcon.show();
            } else {
                $notificationIcon.hide();
            }
        }

        // Initialize models and create a view for each model
        var modelInitPromise = Async.doInParallel(models, function (model, index) {
            var view    = new ExtensionManagerView(),
                promise = view.initialize(model),
                lastNotifyCount;

            promise.always(function () {
                views[index] = view;

                lastNotifyCount = model.notifyCount;
                updateNotificationIcon(index);
            });

            model.on("change", function () {
                if (lastNotifyCount !== model.notifyCount) {
                    lastNotifyCount = model.notifyCount;
                    updateNotificationIcon(index);
                }
            });

            return promise;
        }, true);

        modelInitPromise.always(function () {
            $(".spinner", $dlg).remove();

            views.forEach(function (view) {
                view.$el.appendTo($modalDlg);
            });

            // Update search UI before new tab is shown
            $("a[data-toggle='tab']", $dlg).each(function (index, tabElement) {
                $(tabElement).on("show", function (event) {
                    _activeTabIndex = index;

                    // Focus the search input
                    if (!updateSearchDisabled()) {
                        $dlg.find(".search").focus();
                    }
                });
            });

            // Filter the views when the user types in the search field.
            var searchTimeoutID;
            $dlg.on("input", ".search", function (e) {
                clearTimeout(searchTimeoutID);
                var query = $(this).val();
                searchTimeoutID = setTimeout(function () {
                    views[_activeTabIndex].filter(query);
                    $modalDlg.scrollTop(0);
                }, 200);
            }).on("click", ".search-clear", clearSearch);

            // Sort the extension list based on the current selected sorting criteria
            $dlg.on("change", ".sort-extensions", function (e) {
                var sortBy = $(this).val();
                PreferencesManager.set("extensions.sort", sortBy);
                models.forEach(function (model, index) {
                    if (index <= 1) {
                        model._setSortedExtensionList(ExtensionManager.extensions, index === 1);
                        views[index].filter($(".search").val());
                    }
                });
            });

            // Disable the search field when there are no items in the model
            models.forEach(function (model, index) {
                model.on("change", function () {
                    if (_activeTabIndex === index) {
                        updateSearchDisabled();
                    }
                });
            });

            var $activeTab = $dlg.find(".nav-tabs li.active a");
            if ($activeTab.length) { // If there's already a tab selected, show it
                $activeTab.parent().removeClass("active"); // workaround for bootstrap-tab
                $activeTab.tab("show");
            } else if ($("#toolbar-extension-manager").hasClass('updatesAvailable')) {
                // Open dialog to Installed tab if extension updates are available
                $dlg.find(".nav-tabs a.installed").tab("show");
            } else { // Otherwise show the first tab
                $dlg.find(".nav-tabs a:first").tab("show");
            }
            // If activeTab was explicitly selected by user,
            // then check for the selection
            // Or if there was an update available since activeTab.length would be 0,
            // then check for updatesAvailable class in toolbar-extension-manager
            if (($activeTab.length && $activeTab.hasClass("installed")) || (!$activeTab.length && $("#toolbar-extension-manager").hasClass('updatesAvailable'))) {
                $(".ext-sort-group").hide();
            } else {
                $(".ext-sort-group").show();
            }
        });

        // Handle the 'Install from URL' button.
        $(".extension-manager-dialog .install-from-url")
            .click(function () {
                Metrics.countEvent(Metrics.EVENT_TYPE.EXTENSIONS, "install", "fromURL");
                InstallExtensionDialog.showDialog().done(ExtensionManager.updateFromDownload);
            });

        // Handle the drag/drop zone
        var $dropzone = $("#install-drop-zone"),
            $dropmask = $("#install-drop-zone-mask");

        $dropzone
            .on("dragover", function (event) {
                _stopEvent(event);

                if (!event.originalEvent.dataTransfer.files) {
                    return;
                }

                let items = event.originalEvent.dataTransfer.items,
                    isValidDrop = false,
                    zipMimeTypes = ["application/zip",
                        "application/x-zip",
                        "application/octet-stream",
                        "application/x-zip-compressed"];

                isValidDrop = _.every(items, function (item) {
                    return item.kind === "file" && zipMimeTypes.includes(item.type);
                });

                if (isValidDrop) {
                    // Set an absolute width to stabilize the button size
                    $dropzone.width($dropzone.width());

                    // Show drop styling and message
                    $dropzone.removeClass("drag");
                    $dropzone.addClass("drop");
                } else {
                    event.originalEvent.dataTransfer.dropEffect = "none";
                }
            })
            .on("drop", _stopEvent);

        $dropmask
            .on("dragover", function (event) {
                _stopEvent(event);
                event.originalEvent.dataTransfer.dropEffect = "copy";
            })
            .on("dragleave", function () {
                $dropzone.removeClass("drop");
                $dropzone.addClass("drag");
            })
            .on("drop", function (event) {
                _stopEvent(event);

                if (event.originalEvent.dataTransfer.files) {
                    // Attempt install
                    _installUsingDragAndDrop(event.originalEvent.dataTransfer.files).fail(function (errorFiles) {
                        var message = Strings.INSTALL_EXTENSION_DROP_ERROR;

                        message += "<ul class='dialog-list'>";
                        for(let fileKey of Object.keys(errorFiles)){
                            message += "<li><span class='dialog-filename'>";
                            message += StringUtils.breakableUrl(errorFiles[fileKey].name);
                            message += "</span>: " + Strings.CANT_DROP_ZIP + "</li>";
                        }
                        message += "</ul>";

                        Dialogs.showModalDialog(
                            DefaultDialogs.DIALOG_ID_ERROR,
                            Strings.EXTENSION_MANAGER_TITLE,
                            message
                        );
                    }).always(function () {
                        $dropzone.removeClass("validating");
                        $dropzone.addClass("drag");
                    });

                    // While installing, show validating message
                    $dropzone.removeClass("drop");
                    $dropzone.addClass("validating");
                }
            });

        return new $.Deferred().resolve(dialog).promise();
    }

    CommandManager.register(Strings.CMD_EXTENSION_MANAGER, Commands.FILE_EXTENSION_MANAGER, _showDialog);

    AppInit.appReady(function () {
        $("#toolbar-extension-manager").click(_showDialog);
    });

    // Unit tests
    exports._performChanges = _performChanges;
});
